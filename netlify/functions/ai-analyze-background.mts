/**
 * Function (BACKGROUND) : ai-analyze-background — analyse de coach sur une période.
 * Écrit le résultat dans ai_analyses (déduplication par période) ; le client
 * interroge (poll) la table. En arrière-plan : pas de limite 10 s → timeouts
 * généreux + repli automatique de modèle.
 *
 * POST { days? }  + Authorization: Bearer <jwt>  -> 202
 */
import { requireUser } from "./_shared/supabase.ts";
import { getLlm, isRateLimit } from "./_shared/llm/index.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { checkQuota, recordUsage } from "./_shared/usage.ts";
import { loadPhysio } from "./_shared/physio.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const SYSTEM = `# RÔLE
Tu es un coach d'endurance expérimenté (course à pied, vélo, natation, fitness),
data-driven, pédagogue et honnête. Tu analyses les données Garmin Connect d'UN
athlète et tu produis une analyse exploitable.

# DICTIONNAIRE DES DONNÉES (JSON fourni par l'utilisateur)
- activites[]: activity_type (running, road_biking, ...), start_time (ISO),
  distance_m (mètres), duration_s (secondes), avg_pace_s_per_km (secondes/km),
  avg_hr/max_hr (bpm), aerobic_te/anaerobic_te (Training Effect, échelle 0–5),
  training_load (charge d'entraînement).
- metriques_quotidiennes[]: metric_date, resting_hr (bpm), hrv_avg (ms),
  stress_avg (0–100), vo2max, vo2max_source ('garmin' = mesuré, 'calculated' =
  ESTIMÉ par formule), training_readiness (0–100).
- sommeil[]: sleep_date, total_s/deep_s/rem_s (secondes), score (0–100).

# MÉTHODE (raisonne avant d'écrire, n'expose pas ce raisonnement)
1. Convertis toujours les unités pour l'affichage : km, allure mm:ss/km, durées h:mm.
2. Sépare les sports ; ne mélange pas l'allure course avec le vélo.
3. Dégage les TENDANCES : volume hebdomadaire (hausse/baisse), allure, FC de repos,
   HRV, sommeil, readiness.
4. Détecte une éventuelle SURCHARGE (anaerobic_te élevé répété, FC repos qui monte,
   sommeil/readiness bas) ou au contraire une sous-charge / reprise.

# FORMAT DE SORTIE — Markdown, 300–500 mots
Commence DIRECTEMENT par le titre "## 📊 Bilan". N'écris AUCUNE phrase
d'introduction (pas de "Voici ton analyse...").
## 📊 Bilan
2–3 phrases sur l'état de forme, la charge et la récupération.
## ✅ Points forts
Puces concises (progression, régularité, récup, sommeil, VO₂max...).
## ⚠️ Points de vigilance
Puces (fatigue, surcharge, sommeil insuffisant, FC repos en hausse, monotonie...).
## 🎯 Recommandations
3 à 5 puces ACTIONNABLES et chiffrées (intensité, volume, récupération précise).
## 🗓️ Cap pour la suite
Orientation pour les 1–2 prochaines semaines selon les tendances.

# CONTRAINTES
- Français, tutoiement, ton motivant mais lucide.
- Cite des chiffres RÉELS issus des données (convertis en unités lisibles).
- N'invente JAMAIS une donnée absente (null) : signale-la comme manquante.
- Si vo2max_source = 'calculated', précise explicitement que la VO₂max est une estimation.
- Pas de disclaimer médical générique superflu.`;

async function writeAnalysis(
  sb: SupabaseClient,
  userId: string,
  periodStart: string,
  periodEnd: string,
  model: string | null,
  content: string,
  context: unknown = null,
): Promise<void> {
  await sb
    .from("ai_analyses")
    .delete()
    .eq("user_id", userId)
    .eq("scope", "period")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  await sb
    .from("ai_analyses")
    .insert({
      user_id: userId,
      scope: "period",
      period_start: periodStart,
      period_end: periodEnd,
      model,
      content_md: content,
      context,
    })
    .then(
      () => {},
      () => {},
    );
}

export default async (req: Request): Promise<Response> => {
  const ok202 = () => new Response("", { status: 202 });
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  try {
    ctx = await requireUser(req);
  } catch {
    return ok202();
  }
  const { user, sb } = ctx;
  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body.days) || 30, 7), 120);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const periodStart = since.slice(0, 10);
  const periodEnd = new Date().toISOString().slice(0, 10);
  let model: string | null = null;

  try {
    await checkQuota(sb, user.id, "analyze");
    const cfg = await loadAiConfig(sb, user);
    model = cfg.model;
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    const [acts, metrics, sleep] = await Promise.all([
      sb
        .from("activities")
        .select(
          "activity_type,start_time,distance_m,duration_s,avg_hr,max_hr,avg_pace_s_per_km,training_load,aerobic_te,anaerobic_te",
        )
        .eq("user_id", user.id)
        .gte("start_time", since)
        .order("start_time", { ascending: false })
        .limit(60),
      sb
        .from("daily_metrics")
        .select("metric_date,resting_hr,hrv_avg,stress_avg,vo2max,vo2max_source,training_readiness")
        .eq("user_id", user.id)
        .order("metric_date", { ascending: false })
        .limit(14),
      sb
        .from("sleep")
        .select("sleep_date,total_s,deep_s,rem_s,score")
        .eq("user_id", user.id)
        .order("sleep_date", { ascending: false })
        .limit(14),
    ]);

    const summary = {
      periode_jours: days,
      profil: await loadPhysio(sb, user.id),
      activites: acts.data ?? [],
      metriques_quotidiennes: metrics.data ?? [],
      sommeil: sleep.data ?? [],
    };

    if ((summary.activites as unknown[]).length === 0) {
      await writeAnalysis(
        sb,
        user.id,
        periodStart,
        periodEnd,
        model,
        "## 📊 Bilan\n\nAucune activité sur la période — synchronise d'abord ton Garmin depuis ton profil.",
        summary,
      );
      return ok202();
    }

    const userText =
      "Voici mes données Garmin récentes (JSON). Analyse-les et coache-moi :\n\n" +
      "```json\n" +
      JSON.stringify(summary, null, 2) +
      "\n```";

    const { text: content, usage } = await llm.generate(SYSTEM, userText, {
      maxOutputTokens: 4096,
      thinkingBudget: 1024,
      timeoutMs: 40000,
      perAttemptMs: 12000,
    });
    await recordUsage(sb, user.id, "analyze", usage);
    await writeAnalysis(sb, user.id, periodStart, periodEnd, model, content, summary);
  } catch (e) {
    const msg = isRateLimit(e)
      ? "## ⚠️ Analyse indisponible\n\nLimite de l'API atteinte sur les modèles disponibles. Réessaie plus tard, ou change de modèle/fournisseur dans ton profil."
      : `## ⚠️ Analyse indisponible\n\n${(e as Error).message.slice(0, 160)}`;
    await writeAnalysis(sb, user.id, periodStart, periodEnd, model, msg);
  }
  return ok202();
};
