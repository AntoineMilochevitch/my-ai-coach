/**
 * Function : estimate-nutrition — estime les valeurs nutritionnelles d'un repas
 * décrit en langage naturel, via le provider IA configuré.
 *
 * POST { description }  + Authorization: Bearer <jwt>
 *  -> { label, calories, protein_g, carbs_g, fat_g }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { getLlm } from "./_shared/llm/index.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { checkQuota, recordUsage } from "./_shared/usage.ts";

const SYSTEM = `Tu es un assistant nutrition. À partir de la description d'un repas en
langage naturel, estime ses valeurs nutritionnelles pour la PORTION décrite.
- calories en kcal, protein_g / carbs_g / fat_g en grammes (nombres, arrondis à l'entier).
- Si les quantités ne sont pas précisées, suppose une portion standard raisonnable.
- label = reformulation courte et claire du repas (≤ 60 caractères).
Réponds UNIQUEMENT via le schéma JSON imposé.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    label: { type: "STRING" },
    calories: { type: "NUMBER" },
    protein_g: { type: "NUMBER" },
    carbs_g: { type: "NUMBER" },
    fat_g: { type: "NUMBER" },
  },
  required: ["calories", "protein_g", "carbs_g", "fat_g"],
};

const round = (v: unknown): number => Math.max(0, Math.round(Number(v) || 0));

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const description = String(body.description ?? "").trim().slice(0, 300);
    if (!description) return json({ error: "Décris ton repas." }, 400);

    await checkQuota(sb, user.id, "estimate");
    const cfg = await loadAiConfig(sb, user);
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    const { data, usage } = await llm.generateJSON<{
      label?: string;
      calories?: number;
      protein_g?: number;
      carbs_g?: number;
      fat_g?: number;
    }>(SYSTEM, `Repas : ${description}`, SCHEMA, {
      temperature: 0.2,
      maxOutputTokens: 2048,
      thinkingBudget: 256,
      timeoutMs: 9000,
      perAttemptMs: 4500, // bascule vers un autre modèle si le principal pend
    });
    await recordUsage(sb, user.id, "estimate", usage);

    return json({
      label: (data.label || description).slice(0, 60),
      calories: round(data.calories),
      protein_g: round(data.protein_g),
      carbs_g: round(data.carbs_g),
      fat_g: round(data.fat_g),
    });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
