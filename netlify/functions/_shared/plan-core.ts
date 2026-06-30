/**
 * Cœur de génération du plan adaptatif :
 *  - generateMacro : squelette de périodisation (tout l'horizon).
 *  - generateDetail : séances détaillées pour une fenêtre de semaines (scinde en
 *    cas de troncature).
 *  - weeksToRows : conversion des semaines détaillées en lignes plan_workouts.
 *  - currentWeekOf : semaine en cours du plan dans le fuseau de l'athlète.
 */
import type { LlmClient } from "./llm/index.ts";
import { MaxTokensError } from "./llm/index.ts";
import {
  SYSTEM_MACRO,
  SYSTEM_DETAIL,
  SCHEMA_MACRO,
  SCHEMA_DETAIL,
  type MacroWeek,
  type DetailWeek,
} from "./plan-schema.ts";
import { sanitizeSteps } from "./plan-steps.ts";
import { isoDateUtc, todayInTz } from "./dates.ts";

export const DETAIL_WEEKS = 2;

interface Usage {
  in: number;
  out: number;
}

export async function generateMacro(
  llm: LlmClient,
  athleteText: string,
  numWeeks: number,
  usage: Usage,
): Promise<{ resume: string; semaines: MacroWeek[] }> {
  const userText =
    `Construis le MACRO (périodisation) des ${numWeeks} semaines de ce plan.\n\n${athleteText}`;
  const { data, usage: u } = await llm.generateJSON<{ resume?: string; semaines?: MacroWeek[] }>(
    SYSTEM_MACRO,
    userText,
    SCHEMA_MACRO,
    { maxOutputTokens: 8192, thinkingBudget: 1024, temperature: 0.5 },
  );
  usage.in += u.in;
  usage.out += u.out;
  const semaines = (data.semaines ?? [])
    .map((w) => ({ ...w, num: Number(w.num) || 0 }))
    .filter((w) => w.num >= 1)
    .sort((a, b) => a.num - b.num);
  return { resume: data.resume ?? "", semaines };
}

/** Lignes macro lisibles pour les semaines [from..to], à fournir au générateur de détail. */
export function macroLinesFor(macro: MacroWeek[], from: number, to: number): string {
  return macro
    .filter((w) => w.num >= from && w.num <= to)
    .map(
      (w) =>
        `- Semaine ${w.num} [${w.phase ?? "?"}] ${w.focus ?? ""} : ~${w.volume_km ?? "?"} km, ` +
        `sortie longue ~${w.sortie_longue_km ?? "?"} km, ${w.seances_qualite ?? "?"} séance(s) qualité` +
        (w.note ? ` (${w.note})` : ""),
    )
    .join("\n");
}

export async function generateDetail(
  llm: LlmClient,
  contextText: string,
  macro: MacroWeek[],
  from: number,
  to: number,
  usage: Usage,
): Promise<DetailWeek[]> {
  const userText =
    `Détaille les SÉANCES des semaines ${from} à ${to} (numérote-les ainsi).\n\n` +
    `# MACRO DES SEMAINES À DÉTAILLER\n${macroLinesFor(macro, from, to)}\n\n${contextText}`;
  try {
    const { data, usage: u } = await llm.generateJSON<{ semaines?: DetailWeek[] }>(
      SYSTEM_DETAIL,
      userText,
      SCHEMA_DETAIL,
      { maxOutputTokens: 12288, thinkingBudget: 2048, temperature: 0.5 },
    );
    usage.in += u.in;
    usage.out += u.out;
    return data.semaines ?? [];
  } catch (e) {
    // Troncature : on scinde la fenêtre (jusqu'à 1 semaine par appel).
    if (e instanceof MaxTokensError && to > from) {
      const mid = Math.floor((from + to) / 2);
      const a = await generateDetail(llm, contextText, macro, from, mid, usage);
      const b = await generateDetail(llm, contextText, macro, mid + 1, to, usage);
      return [...a, ...b];
    }
    throw e;
  }
}

/** Convertit les semaines détaillées en lignes plan_workouts (dates ancrées UTC). */
export function weeksToRows(
  weeks: DetailWeek[],
  planId: string,
  userId: string,
  startUtc: Date,
): any[] {
  const rows: any[] = [];
  for (const week of weeks) {
    const wnum = Number(week.num) || 1;
    for (const s of week.seances ?? []) {
      if (s?.type === "rest") continue;
      const jour = Math.min(Math.max(Number(s.jour) || 1, 1), 7);
      const date = new Date(startUtc);
      date.setUTCDate(startUtc.getUTCDate() + (wnum - 1) * 7 + (jour - 1));
      rows.push({
        plan_id: planId,
        user_id: userId,
        scheduled_date: isoDateUtc(date),
        sport: String(s.sport || "running"),
        title: String(s.titre || s.type || "Séance"),
        description: String(s.description || ""),
        session_type: String(s.type || "easy"),
        week_number: wnum,
        target: {
          distance_km: s.distance_km ?? null,
          duree_min: s.duree_min ?? null,
          allure: s.allure ?? null,
          zone_fc: s.zone_fc ?? null,
        },
        steps: sanitizeSteps(s.steps),
        status: "planned",
      });
    }
  }
  return rows;
}

/** Semaine en cours du plan (1..numWeeks) dans le fuseau de l'athlète. */
export function currentWeekOf(startDate: string, tz: string, numWeeks: number): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const today = new Date(`${todayInTz(tz)}T00:00:00Z`);
  const diffWeeks = Math.floor((today.getTime() - start.getTime()) / (7 * 86400000));
  return Math.min(Math.max(diffWeeks + 1, 1), Math.max(numWeeks, 1));
}
