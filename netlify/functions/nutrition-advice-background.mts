/**
 * Function (BACKGROUND) : nutrition-advice-background — conseils nutrition croisés
 * avec la charge d'entraînement. Écrit le résultat dans ai_analyses (scope
 * 'nutrition') ; le client interroge (poll) la table. Timeouts généreux + repli.
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
Tu es un coach sportif et nutrition, data-driven, pédagogue et honnête.
Tu analyses l'alimentation d'un athlète en la CROISANT avec sa charge d'entraînement.

# DICTIONNAIRE
- nutrition[] : entry_date, meal (repas), label, calories (kcal), protein_g, carbs_g, fat_g.
- activites[] : activity_type, start_time, distance_m (m), duration_s (s), training_load, calories.
- metriques : resting_hr (bpm), vo2max, training_readiness (0-100).

# TÂCHE
Évalue les apports (énergie totale, protéines, glucides autour des séances) au regard
du volume/intensité d'entraînement. Repère sous/sur-alimentation, déficit protéique,
glucides insuffisants les jours de grosse charge. Donne des conseils concrets.

# FORMAT — Markdown, 250-400 mots, commence DIRECTEMENT par "## 🍽️ Bilan"
## 🍽️ Bilan
## ⚖️ Apports vs charge d'entraînement
## ✅ À conserver
## 🎯 Recommandations
3 à 5 puces ACTIONNABLES et chiffrées (ex. "vise ~1,6 g protéines/kg", "ajoute ~50 g
de glucides avant les sorties longues").

# CONTRAINTES
- Français, tutoiement, ton motivant et lucide.
- Cite des chiffres RÉELS issus des données. N'invente jamais une donnée absente.
- Reste dans le cadre du conseil sportif : pas de régime médical strict ni de diagnostic.`;

async function writeAdvice(
  sb: SupabaseClient,
  userId: string,
  periodStart: string,
  periodEnd: string,
  model: string | null,
  content: string,
): Promise<void> {
  await sb
    .from("ai_analyses")
    .delete()
    .eq("user_id", userId)
    .eq("scope", "nutrition")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  await sb
    .from("ai_analyses")
    .insert({
      user_id: userId,
      scope: "nutrition",
      period_start: periodStart,
      period_end: periodEnd,
      model,
      content_md: content,
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
  const days = Math.min(Math.max(Number(body.days) || 7, 3), 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const periodStart = since.slice(0, 10);
  const periodEnd = new Date().toISOString().slice(0, 10);
  let model: string | null = null;

  try {
    await checkQuota(sb, user.id, "nutrition");
    const cfg = await loadAiConfig(sb, user);
    model = cfg.model;
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    const [nut, acts, metrics] = await Promise.all([
      sb
        .from("nutrition_entries")
        .select("entry_date, meal, label, calories, protein_g, carbs_g, fat_g")
        .eq("user_id", user.id)
        .gte("entry_date", periodStart)
        .order("entry_date", { ascending: false })
        .limit(150),
      sb
        .from("activities")
        .select("activity_type, start_time, distance_m, duration_s, training_load, calories")
        .eq("user_id", user.id)
        .gte("start_time", since)
        .order("start_time", { ascending: false })
        .limit(40),
      sb
        .from("daily_metrics")
        .select("resting_hr, vo2max, training_readiness")
        .eq("user_id", user.id)
        .order("metric_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!nut.data?.length) {
      await writeAdvice(
        sb,
        user.id,
        periodStart,
        periodEnd,
        model,
        "## 🍽️ Bilan\n\nAjoute d'abord quelques repas dans l'onglet Nutrition pour obtenir des conseils croisés avec ta charge.",
      );
      return ok202();
    }

    const summary = {
      periode_jours: days,
      profil: await loadPhysio(sb, user.id),
      nutrition: nut.data,
      activites: acts.data ?? [],
      metriques: metrics.data ?? null,
    };
    const userText =
      "Croise mon alimentation et ma charge d'entraînement récentes (JSON) :\n\n" +
      "```json\n" +
      JSON.stringify(summary, null, 2) +
      "\n```";

    const { text: content, usage } = await llm.generate(SYSTEM, userText, {
      maxOutputTokens: 4096,
      thinkingBudget: 1024,
      timeoutMs: 40000,
      perAttemptMs: 12000,
    });
    await recordUsage(sb, user.id, "nutrition", usage);
    await writeAdvice(sb, user.id, periodStart, periodEnd, model, content);
  } catch (e) {
    const msg = isRateLimit(e)
      ? "## ⚠️ Conseils indisponibles\n\nLimite de l'API atteinte sur les modèles disponibles. Réessaie plus tard, ou change de modèle/fournisseur dans ton profil."
      : `## ⚠️ Conseils indisponibles\n\n${(e as Error).message.slice(0, 160)}`;
    await writeAdvice(sb, user.id, periodStart, periodEnd, model, msg);
  }
  return ok202();
};
