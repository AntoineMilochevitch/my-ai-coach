/**
 * Function : garmin-push-workout — crée des séances dans Garmin Connect et les
 * planifie sur le calendrier (elles se synchronisent ensuite sur la montre).
 *
 * POST { planWorkoutId? , all?: boolean }  + Authorization: Bearer <jwt>
 *  -> { pushed, errors }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { loadTokens, storeTokens } from "./_shared/garmin/tokens.ts";
import { refreshTokens, tokenExpiresSoon, type GarminTokens } from "./_shared/garmin/auth.ts";
import { buildRunningWorkout, pushRunningWorkout } from "./_shared/garmin/workout.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    let tokens = await loadTokens(sb, user.id);
    if (!tokens) return json({ error: "Garmin non connecté" }, 400);
    if (tokenExpiresSoon(tokens.accessToken)) {
      tokens = await refreshTokens(tokens);
      await storeTokens(sb, user.id, tokens);
    }
    const token = (tokens as GarminTokens).accessToken;

    const body = await req.json().catch(() => ({}));

    let query = sb
      .from("plan_workouts")
      .select("id, scheduled_date, sport, session_type, title, description, target, steps, garmin_workout_id")
      .eq("user_id", user.id);
    if (body.planWorkoutId) query = query.eq("id", body.planWorkoutId);
    else {
      // "Tout envoyer" : séances course à venir non encore poussées.
      const today = new Date().toISOString().slice(0, 10);
      query = query.gte("scheduled_date", today).is("garmin_workout_id", null);
    }
    const { data: workouts, error } = await query;
    if (error) throw new Error(error.message);
    if (!workouts?.length) return json({ pushed: 0, errors: [] });

    let pushed = 0;
    const errors: string[] = [];
    const RUN_TYPES = ["easy", "long", "tempo", "interval", "recovery"];
    for (const w of workouts) {
      const sport = (w.sport ?? "").toLowerCase();
      const isRun =
        sport.includes("run") ||
        sport.includes("cours") ||
        RUN_TYPES.includes((w.session_type ?? "").toLowerCase());
      if (!isRun) {
        errors.push(`${w.title}: type non supporté (course uniquement)`);
        continue;
      }
      const payload = buildRunningWorkout(
        w.title ?? "Séance",
        w.description ?? "",
        w.target,
        w.steps,
      );
      if (!payload) {
        errors.push(`${w.title}: pas de cible (distance/durée) exploitable`);
        continue;
      }
      try {
        const workoutId = await pushRunningWorkout(token, payload, w.scheduled_date);
        if (workoutId) {
          await sb
            .from("plan_workouts")
            .update({ garmin_workout_id: workoutId })
            .eq("id", w.id);
          pushed++;
        }
      } catch (e) {
        errors.push(`${w.title}: ${(e as Error).message}`);
      }
    }

    return json({ pushed, errors });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
