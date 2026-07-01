/**
 * Function (BACKGROUND) : nutrition-plan-background — génère un PLAN NUTRITION
 * personnalisé (repas recommandés + macros cibles + explications), calibré sur
 * l'objectif d'entraînement, la charge récente et l'alimentation actuelle.
 * Upsert dans nutrition_plans ; le client interroge (poll) la table.
 *
 * POST { constraints? }  + Authorization: Bearer <jwt>  -> 202
 */
import { requireUser } from "./_shared/supabase.ts";
import { getLlm, isRateLimit } from "./_shared/llm/index.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { checkQuota, recordUsage } from "./_shared/usage.ts";
import { buildAthleteContext } from "./_shared/plan-context.ts";

const SYSTEM = `# RÔLE
Tu es un coach de nutrition sportive. Tu construis un PLAN NUTRITION personnalisé, calibré sur
l'objectif d'entraînement, la charge récente et l'alimentation actuelle de l'athlète.

# TÂCHE (remplis le schéma JSON)
- besoins_journaliers : besoins par TYPE de jour (au moins "Repos", "Facile", "Qualité/Longue"),
  chacun avec kcal + protéines/glucides/lipides (g) + une note courte.
- repas : pour une JOURNÉE TYPE (Petit-déjeuner, Déjeuner, Collation, Dîner), chaque repas avec
  kcal + macros cibles, une IDÉE concrète de repas, et une courte justification (rationale).
- hydratation : recommandation d'hydratation.
- autour_seances : quoi manger/boire avant, pendant et après les séances.
- resume : 1-2 phrases sur l'approche globale.

# CONTRAINTES
- Français, tutoiement, concret et chiffré.
- Calibre les GLUCIDES sur la charge (davantage les jours de grosse séance).
- Si le poids de corps est inconnu, base-toi sur un athlète type + la charge et précise-le
  brièvement (ex. "vise ~1,6-2 g de protéines/kg").
- Respecte les CONTRAINTES de l'athlète (allergies, régime, préférences, poids) si fournies.
- Reste dans le conseil sportif : pas de régime médical strict ni de diagnostic.
Réponds UNIQUEMENT via le schéma JSON.`;

const MACROS = {
  kcal: { type: "INTEGER" },
  prot_g: { type: "INTEGER" },
  gluc_g: { type: "INTEGER" },
  lip_g: { type: "INTEGER" },
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    resume: { type: "STRING" },
    besoins_journaliers: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { type: { type: "STRING" }, ...MACROS, note: { type: "STRING" } },
        required: ["type"],
      },
    },
    repas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nom: { type: "STRING" },
          ...MACROS,
          idee: { type: "STRING" },
          rationale: { type: "STRING" },
        },
        required: ["nom"],
      },
    },
    hydratation: { type: "STRING" },
    autour_seances: { type: "STRING" },
    pendant_effort: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          duree: { type: "STRING" }, // ex "< 1h", "1-2h", "> 2h"
          glucides: { type: "STRING" }, // ex "30-60 g/h"
          hydratation: { type: "STRING" }, // ex "400-600 ml/h + électrolytes"
          exemples: { type: "STRING" }, // ex "gel, boisson glucidique, banane"
        },
        required: ["duree"],
      },
    },
  },
  required: ["repas"],
};

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
  const constraints = String(body.constraints || "").slice(0, 500);
  const includeInEffort = body.includeInEffort === true;
  let model: string | null = null;

  try {
    await checkQuota(sb, user.id, "nutrition");
    const cfg = await loadAiConfig(sb, user);
    model = cfg.model;
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    const { data: plan } = await sb
      .from("training_plans")
      .select("goal")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    const context = await buildAthleteContext(sb, user.id, null);

    const athlete = {
      objectif: plan?.goal ?? "Forme générale",
      contraintes: constraints || null,
      contexte: context,
    };
    const inEffortClause = includeInEffort
      ? "Inclus AUSSI un plan de ravitaillement PENDANT l'effort (pendant_effort), par durée de séance " +
        "(< 1h, 1-2h, > 2h) : glucides par heure, hydratation, et exemples concrets."
      : "N'inclus PAS de ravitaillement pendant l'effort : laisse pendant_effort vide.";
    const userText =
      "Construis mon plan nutrition personnalisé (JSON) à partir de ces données. " +
      inEffortClause +
      "\n\n```json\n" +
      JSON.stringify(athlete, null, 2) +
      "\n```";

    const { data, usage } = await llm.generateJSON(SYSTEM, userText, SCHEMA, {
      maxOutputTokens: 8192,
      thinkingBudget: 1024,
      temperature: 0.5,
      timeoutMs: 40000,
      perAttemptMs: 12000,
    });
    await recordUsage(sb, user.id, "nutrition", usage);
    await sb
      .from("nutrition_plans")
      .upsert(
        { user_id: user.id, content: data, model, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
  } catch (e) {
    const msg = isRateLimit(e)
      ? "Limite de l'API atteinte sur les modèles disponibles. Réessaie plus tard, ou change de modèle dans ton profil."
      : (e as Error).message.slice(0, 160);
    await sb
      .from("nutrition_plans")
      .upsert(
        { user_id: user.id, content: { error: msg }, model, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      )
      .then(
        () => {},
        () => {},
      );
  }
  return ok202();
};
