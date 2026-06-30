/**
 * Rapprochement séances planifiées <-> activités réalisées pour le plan actif :
 *  - séance du jour avec activité même sport -> status "done" (+ completed_activity_id)
 *  - séance passée sans activité correspondante -> status "missed"
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateInTz, todayInTz } from "./dates.ts";

function sportMatch(workoutSport: string, activityType: string | null): boolean {
  if (!activityType) return false;
  const w = (workoutSport || "").toLowerCase();
  const a = activityType.toLowerCase();
  if ((w.includes("run") || w.includes("course")) && a.includes("run")) return true;
  if (
    (w.includes("cycl") || w.includes("velo") || w.includes("bik")) &&
    (a.includes("bik") || a.includes("cycl"))
  )
    return true;
  return a.includes(w) || (w.length > 2 && w.includes(a));
}

export async function matchPlanForUser(
  sb: SupabaseClient,
  userId: string,
): Promise<{ matched: number; missed: number }> {
  // Fuseau de l'athlète : les activités (timestamptz) doivent être rattachées au
  // bon jour calendaire local, sinon une sortie du soir tombe la veille en UTC.
  const { data: prof } = await sb
    .from("profiles")
    .select("settings")
    .eq("id", userId)
    .maybeSingle();
  const tz =
    typeof (prof?.settings as any)?.timezone === "string" && (prof?.settings as any).timezone
      ? (prof!.settings as any).timezone
      : "Europe/Paris";

  const { data: plan } = await sb
    .from("training_plans")
    .select("id, start_date, end_date")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!plan) return { matched: 0, missed: 0 };

  const { data: workouts } = await sb
    .from("plan_workouts")
    .select("id, scheduled_date, sport")
    .eq("user_id", userId)
    .eq("plan_id", plan.id)
    .eq("status", "planned");
  if (!workouts?.length) return { matched: 0, missed: 0 };

  const { data: acts } = await sb
    .from("activities")
    .select("id, start_time, activity_type")
    .eq("user_id", userId)
    .gte("start_time", `${plan.start_date}T00:00:00`)
    .lte("start_time", `${plan.end_date}T23:59:59`);

  const byDate = new Map<string, { id: string; activity_type: string | null }[]>();
  for (const a of acts ?? []) {
    if (!a.start_time) continue;
    const d = dateInTz(new Date(a.start_time), tz);
    (byDate.get(d) ?? byDate.set(d, []).get(d)!).push({
      id: a.id,
      activity_type: a.activity_type,
    });
  }

  const today = todayInTz(tz);
  const used = new Set<string>();
  const updates: PromiseLike<unknown>[] = [];
  let matched = 0;
  let missed = 0;

  for (const w of workouts) {
    const candidates = byDate.get(w.scheduled_date) ?? [];
    const hit = candidates.find(
      (a) => !used.has(a.id) && sportMatch(w.sport, a.activity_type),
    );
    if (hit) {
      used.add(hit.id);
      matched++;
      updates.push(
        sb
          .from("plan_workouts")
          .update({ status: "done", completed_activity_id: hit.id })
          .eq("id", w.id),
      );
    } else if (w.scheduled_date < today) {
      missed++;
      updates.push(
        sb.from("plan_workouts").update({ status: "missed" }).eq("id", w.id),
      );
    }
  }
  await Promise.all(updates);
  return { matched, missed };
}
