/**
 * Function : nutrition-advice — conseils nutrition (Gemini) croisés avec la
 * charge d'entraînement récente.
 *
 * POST { days? }  + Authorization: Bearer <jwt>  -> { content_md }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { getLlm } from "./_shared/llm/index.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { checkQuota, recordUsage } from "./_shared/usage.ts";

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

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    await checkQuota(sb, user.id, "nutrition");
    const cfg = await loadAiConfig(sb, user);
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days) || 7, 3), 30);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const sinceDate = since.slice(0, 10);

    const [nut, acts, metrics] = await Promise.all([
      sb
        .from("nutrition_entries")
        .select("entry_date, meal, label, calories, protein_g, carbs_g, fat_g")
        .eq("user_id", user.id)
        .gte("entry_date", sinceDate)
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
      return json(
        { error: "Ajoute d'abord quelques repas pour obtenir des conseils." },
        400,
      );
    }

    const summary = {
      periode_jours: days,
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
    });
    await recordUsage(sb, user.id, "nutrition", usage);
    return json({ content_md: content });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
