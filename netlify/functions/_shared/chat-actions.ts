/**
 * Détection d'ACTIONS dans le chat coach : à partir du message de l'athlète, on
 * décide s'il demande explicitement une action (créer/adapter un plan, ajouter de
 * la nutrition ou une note) et on en extrait les arguments. L'action est ensuite
 * proposée à la confirmation dans la conversation (jamais exécutée automatiquement).
 *
 * Provider-agnostique : repose sur generateJSON (Gemini / Claude / OpenAI).
 */
import type { LlmClient, TokenUsage } from "./llm/index.ts";

export type ActionKind = "create_plan" | "adapt_plan" | "add_nutrition" | "add_note";

export interface DetectedAction {
  kind: ActionKind;
  args: Record<string, unknown>;
  summary: string;
  assistant: string;
}

// Pré-filtre : n'appelle le classifieur que si le message évoque une action,
// pour ne pas payer un appel IA supplémentaire sur la conversation courante.
const HINT =
  /\b(cr[ée]e|cr[ée]er|g[ée]n[èe]re|fais[ -]?moi|construis|pr[ée]pare|adapte|ajuste|recalcule|modifie|change|remplace|ajoute|enregistre|note|plan|programme|objectif|s[ée]ance|repas|mang|d[ée]jeuner|d[îi]ner|petit[ -]?d[ée]jeuner|collation|calorie|prot[ée]ine|glucide)/i;

export function mightBeAction(message: string): boolean {
  return HINT.test(message);
}

const SYSTEM = `Tu es le routeur d'actions d'un coach sportif. À partir du DERNIER message de
l'athlète, détermine s'il demande EXPLICITEMENT d'effectuer une action, et laquelle.

Actions :
- "create_plan" : créer/générer un NOUVEAU plan d'entraînement. Remplis objective
  ("5 km"|"10 km"|"Semi-marathon"|"Marathon"|"Trail"|"Forme générale"), targetTime (chrono visé,
  ex "45:00" ou "3h30"), distanceKm/elevationM (trail), weeks OU targetDate (AAAA-MM-JJ),
  sessionsPerWeek ou preferredDays (1=lundi..7=dimanche), maxSessionMin, level, constraints.
  Ne propose create_plan QUE si l'objectif est clair (et un chrono pour une course) ; sinon "none".
- "adapt_plan" : adapter/ajuster le plan ACTUEL à la forme récente. Aucun argument.
- "add_nutrition" : enregistrer un repas. Remplis meal (Petit-déjeuner|Déjeuner|Dîner|Collation),
  date (AAAA-MM-JJ, défaut aujourd'hui), items[] {label, calories, protein_g, carbs_g, fat_g} en
  ESTIMANT les valeurs nutritionnelles de chaque aliment.
- "add_note" : enregistrer une note / un ressenti. Remplis content (et date si précisée).
- "none" : simple question/discussion, ou information insuffisante (le coach répondra normalement).

Champs de sortie :
- action : une valeur ci-dessus.
- assistant : 1 courte phrase d'introduction adressée à l'athlète (tutoiement).
- summary : récapitulatif lisible et concis de l'action proposée (ce que l'athlète va confirmer).
- args : uniquement les champs pertinents (vide pour "none" et "adapt_plan").
En cas de doute, choisis "none".`;

const ITEM = {
  type: "OBJECT",
  properties: {
    label: { type: "STRING" },
    calories: { type: "NUMBER" },
    protein_g: { type: "NUMBER" },
    carbs_g: { type: "NUMBER" },
    fat_g: { type: "NUMBER" },
  },
  required: ["label"],
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    action: { type: "STRING" },
    assistant: { type: "STRING" },
    summary: { type: "STRING" },
    args: {
      type: "OBJECT",
      properties: {
        objective: { type: "STRING" },
        targetTime: { type: "STRING" },
        distanceKm: { type: "NUMBER" },
        elevationM: { type: "NUMBER" },
        weeks: { type: "INTEGER" },
        targetDate: { type: "STRING" },
        sessionsPerWeek: { type: "INTEGER" },
        preferredDays: { type: "ARRAY", items: { type: "INTEGER" } },
        maxSessionMin: { type: "INTEGER" },
        level: { type: "STRING" },
        constraints: { type: "STRING" },
        date: { type: "STRING" },
        meal: { type: "STRING" },
        items: { type: "ARRAY", items: ITEM },
        content: { type: "STRING" },
      },
    },
  },
  required: ["action"],
};

const VALID: ActionKind[] = ["create_plan", "adapt_plan", "add_nutrition", "add_note"];

export async function detectAction(
  llm: LlmClient,
  message: string,
): Promise<{ action: DetectedAction | null; usage: TokenUsage | null }> {
  try {
    const { data, usage } = await llm.generateJSON<{
      action?: string;
      assistant?: string;
      summary?: string;
      args?: Record<string, unknown>;
    }>(SYSTEM, `Message de l'athlète : ${message}`, SCHEMA, {
      temperature: 0.1,
      maxOutputTokens: 1024,
      thinkingBudget: 0,
    });
    const kind = data.action as ActionKind;
    if (!VALID.includes(kind)) return { action: null, usage };
    return {
      action: {
        kind,
        args: data.args ?? {},
        summary: String(data.summary ?? "").slice(0, 600),
        assistant: String(data.assistant ?? data.summary ?? "Action proposée :").slice(0, 300),
      },
      usage,
    };
  } catch {
    // En cas d'échec du classifieur, on retombe sur le chat normal.
    return { action: null, usage: null };
  }
}
