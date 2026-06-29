/**
 * Function : garmin-push-workout — crée des séances dans Garmin Connect et les
 * planifie sur le calendrier (elles se synchronisent ensuite sur la montre).
 *
 * POST { planWorkoutId? , all?: boolean }  + Authorization: Bearer <jwt>
 *  -> { pushed, errors }
 *
 * Construit un workout "running" simple (un palier distance ou durée) depuis la
 * cible de la séance. Référence du format : python-garminconnect/workout.py.
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { loadTokens, storeTokens } from "./_shared/garmin/tokens.ts";
import {
  connectApiPost,
  refreshTokens,
  tokenExpiresSoon,
  type GarminTokens,
} from "./_shared/garmin/auth.ts";

interface Target {
  distance_km?: number | null;
  duree_min?: number | null;
  allure?: string | null;
  zone_fc?: string | null;
}

const RUNNING = { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 };
const NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 };

function buildRunningWorkout(title: string, description: string, target: Target | null) {
  let endCondition: Record<string, unknown>;
  let endConditionValue: number;
  if (target?.distance_km) {
    endCondition = { conditionTypeId: 3, conditionTypeKey: "distance", displayOrder: 3, displayable: true };
    endConditionValue = Math.round(target.distance_km * 1000); // mètres
  } else if (target?.duree_min) {
    endCondition = { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true };
    endConditionValue = Math.round(target.duree_min * 60); // secondes
  } else {
    return null; // pas de cible exploitable
  }

  const est = target?.duree_min
    ? target.duree_min * 60
    : target?.distance_km
      ? Math.round(target.distance_km * 5 * 60) // ~5 min/km par défaut
      : 1800;

  return {
    workoutName: title.slice(0, 80) || "Séance",
    description: (description || "").slice(0, 1000),
    sportType: RUNNING,
    estimatedDurationInSecs: est,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: RUNNING,
        workoutSteps: [
          {
            type: "ExecutableStepDTO",
            stepOrder: 1,
            stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
            endCondition,
            endConditionValue,
            targetType: NO_TARGET,
          },
        ],
      },
    ],
  };
}

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
      .select("id, scheduled_date, sport, session_type, title, description, target, garmin_workout_id")
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
      const payload = buildRunningWorkout(w.title ?? "Séance", w.description ?? "", w.target);
      if (!payload) {
        errors.push(`${w.title}: pas de cible (distance/durée) exploitable`);
        continue;
      }
      try {
        const created = await connectApiPost<{ workoutId: number }>(
          token,
          "/workout-service/workout",
          payload,
        );
        if (created?.workoutId) {
          await connectApiPost(token, `/workout-service/schedule/${created.workoutId}`, {
            date: w.scheduled_date,
          });
          await sb
            .from("plan_workouts")
            .update({ garmin_workout_id: created.workoutId })
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
