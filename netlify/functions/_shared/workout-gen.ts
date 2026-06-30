/**
 * Génère les étapes structurées ("steps") d'UNE séance de course à partir d'une
 * description en langage naturel + cibles éventuelles. Réutilisé par la création
 * (chat → montre) et l'édition de séance.
 */
import type { LlmClient, TokenUsage } from "./llm/index.ts";
import { STEPS_SCHEMA } from "./plan-schema.ts";
import { sanitizeSteps, type CleanStep } from "./plan-steps.ts";

const SYSTEM = `Tu es un coach de course à pied. Construis les ÉTAPES ("steps") d'UNE séance
de course, cohérentes avec la description et les cibles fournies.
- kind = "step" (étape simple) ou "repeat" (bloc répété).
- step simple : type ∈ {warmup, run, interval, recovery, cooldown}, endType ∈ {time, distance, lap},
  + durationSec (si time) OU distanceM (si distance), + allures paceLow/paceHigh en min/km
  (ex "5:15"/"5:00") quand pertinent, ou hrZone (1-5).
- bloc "repeat" : repeatCount + steps[] (sous-étapes répétées, ex. interval + recovery).
Inclus un échauffement et un retour au calme si pertinent. Réponds UNIQUEMENT via le schéma JSON.`;

const SCHEMA = {
  type: "OBJECT",
  properties: { steps: STEPS_SCHEMA },
  required: ["steps"],
};

export interface WorkoutSpec {
  description?: string | null;
  distanceKm?: number | null;
  dureeMin?: number | null;
  allure?: string | null;
  sessionType?: string | null;
}

export async function generateWorkoutSteps(
  llm: LlmClient,
  spec: WorkoutSpec,
): Promise<{ steps: CleanStep[] | null; usage: TokenUsage }> {
  const lines = [
    spec.description ? `Description : ${spec.description}` : "",
    spec.sessionType ? `Type : ${spec.sessionType}` : "",
    spec.distanceKm ? `Distance cible : ${spec.distanceKm} km` : "",
    spec.dureeMin ? `Durée cible : ${spec.dureeMin} min` : "",
    spec.allure ? `Allure cible : ${spec.allure}/km` : "",
  ].filter(Boolean);

  const { data, usage } = await llm.generateJSON<{ steps?: unknown }>(
    SYSTEM,
    `Séance de course :\n${lines.join("\n")}`,
    SCHEMA,
    { temperature: 0.3, maxOutputTokens: 4096, thinkingBudget: 512 },
  );
  return { steps: sanitizeSteps(data.steps), usage };
}
