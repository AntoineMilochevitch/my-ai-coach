/**
 * Adaptation roulante du plan actif : on (re)détaille la fenêtre de semaines à
 * venir (DETAIL_WEEKS à partir de la semaine en cours) en fonction de l'état de
 * forme RÉEL (réalisé vs cible, récupération, nutrition, notes). On ne touche
 * jamais aux séances passées, déjà faites, ou déjà envoyées sur Garmin.
 *
 * Utilisé par l'endpoint manuel (adapt-plan-background) ET le cron hebdomadaire.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLlm } from "./llm/index.ts";
import { loadAiConfig, type UserLike } from "./ai-config.ts";
import { recordUsage, checkQuota } from "./usage.ts";
import { matchPlanForUser } from "./plan-match.ts";
import { buildAthleteContext } from "./plan-context.ts";
import { generateDetail, weeksToRows, currentWeekOf, DETAIL_WEEKS } from "./plan-core.ts";
import { todayInTz } from "./dates.ts";
import type { MacroWeek } from "./plan-schema.ts";

export interface AdaptResult {
  status: "adapted" | "no-plan" | "skipped";
  weeks?: [number, number];
  inserted?: number;
}

export async function adaptPlanForUser(
  sb: SupabaseClient,
  user: UserLike,
  opts: { enforceQuota?: boolean } = {},
): Promise<AdaptResult> {
  const { data: plan } = await sb
    .from("training_plans")
    .select("id, start_date, macro, detail_weeks, content")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!plan?.macro) return { status: "no-plan" };

  const macro: MacroWeek[] = (plan.macro as any)?.semaines ?? [];
  if (!macro.length) return { status: "no-plan" };
  const numWeeks = macro.length;

  if (opts.enforceQuota) await checkQuota(sb, user.id, "plan");

  // Met à jour fait/manqué avant d'évaluer le réalisé.
  await matchPlanForUser(sb, user.id).catch(() => {});

  const cfg = await loadAiConfig(sb, user);
  const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);
  const tz = cfg.timezone;

  const W = currentWeekOf(plan.start_date, tz, numWeeks);
  const horizon = Number(plan.detail_weeks) || DETAIL_WEEKS;
  const from = W;
  const to = Math.min(numWeeks, W + horizon - 1);
  if (from > numWeeks) return { status: "skipped" }; // plan terminé

  const today = todayInTz(tz);
  const startUtc = new Date(`${plan.start_date}T00:00:00Z`);

  // Supprime les séances FUTURES re-générables de la fenêtre (planifiées, non
  // envoyées sur Garmin). On préserve faites/manquées/poussées.
  await sb
    .from("plan_workouts")
    .delete()
    .eq("plan_id", plan.id)
    .gte("week_number", from)
    .lte("week_number", to)
    .gte("scheduled_date", today)
    .eq("status", "planned")
    .is("garmin_workout_id", null);

  // Dates déjà occupées (séances conservées) → on évite les doublons.
  const { data: kept } = await sb
    .from("plan_workouts")
    .select("scheduled_date")
    .eq("plan_id", plan.id)
    .gte("week_number", from)
    .lte("week_number", to);
  const occupied = new Set((kept ?? []).map((k) => String(k.scheduled_date)));

  const context = await buildAthleteContext(sb, user.id, plan.id);
  const athleteText =
    `État de forme et réalisé de l'athlète (JSON). Adapte les séances à venir en conséquence :\n\n` +
    `\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;

  const usage = { in: 0, out: 0 };
  const weeks = await generateDetail(llm, athleteText, macro, from, to, usage);
  await recordUsage(sb, user.id, "plan", usage);

  // N'insère que les séances futures (>= aujourd'hui) sur des dates libres.
  const rows = weeksToRows(weeks, plan.id, user.id, startUtc).filter(
    (r) => r.scheduled_date >= today && !occupied.has(r.scheduled_date),
  );
  if (rows.length) {
    const { error } = await sb.from("plan_workouts").insert(rows);
    if (error) throw new Error(error.message);
  }

  // last_adapted_at = signal de fin pour le client ; on efface une éventuelle
  // erreur d'adaptation précédente.
  const resume = (plan.content as { resume?: string } | null)?.resume ?? null;
  await sb
    .from("training_plans")
    .update({ last_adapted_at: new Date().toISOString(), content: { resume } })
    .eq("id", plan.id);

  return { status: "adapted", weeks: [from, to], inserted: rows.length };
}
