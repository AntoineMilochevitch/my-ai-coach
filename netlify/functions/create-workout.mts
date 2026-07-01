/**
 * Function : create-workout — crée UNE séance de course (étapes générées par IA)
 * et l'envoie sur la montre via Garmin Connect.
 *
 * POST { spec: { title, sport?, date?, description?, distance_km?, duree_min?, allure?, sessionType? } }
 *  + Authorization: Bearer <jwt>  -> { pushed, garminWorkoutId, scheduled_date }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { loadTokens, storeTokens } from "./_shared/garmin/tokens.ts";
import { refreshTokens, tokenExpiresSoon, type GarminTokens } from "./_shared/garmin/auth.ts";
import { buildRunningWorkout, pushRunningWorkout } from "./_shared/garmin/workout.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { getLlm } from "./_shared/llm/index.ts";
import { generateWorkoutSteps } from "./_shared/workout-gen.ts";
import { recordUsage } from "./_shared/usage.ts";
import { dateInTz } from "./_shared/dates.ts";

const RUN_TYPES = ["easy", "long", "tempo", "interval", "recovery"];

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const spec = body.spec ?? body ?? {};

    const sport = String(spec.sport || "running").toLowerCase();
    const sessionType = String(spec.sessionType || "").toLowerCase();
    const isRun =
      sport.includes("run") || sport.includes("cours") || RUN_TYPES.includes(sessionType);
    if (!isRun)
      return json(
        { error: "Seules les séances de course peuvent être envoyées sur Garmin pour l'instant." },
        400,
      );

    let tokens = await loadTokens(sb, user.id);
    if (!tokens) return json({ error: "Garmin non connecté — connecte ton compte dans le profil." }, 400);
    if (tokenExpiresSoon(tokens.accessToken)) {
      tokens = await refreshTokens(tokens);
      await storeTokens(sb, user.id, tokens);
    }
    const token = (tokens as GarminTokens).accessToken;

    const cfg = await loadAiConfig(sb, user);
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    const target = {
      distance_km: spec.distance_km != null ? Number(spec.distance_km) : null,
      duree_min: spec.duree_min != null ? Number(spec.duree_min) : null,
      allure: spec.allure ?? null,
      zone_fc: null,
    };

    const { steps, usage } = await generateWorkoutSteps(llm, {
      description: spec.description,
      distanceKm: target.distance_km,
      dureeMin: target.duree_min,
      allure: target.allure,
      sessionType,
    });
    await recordUsage(sb, user.id, "plan", usage);

    const title = String(spec.title || "Séance").slice(0, 80);
    const payload = buildRunningWorkout(title, String(spec.description || ""), target, steps);
    if (!payload)
      return json({ error: "Séance non exploitable (précise une distance, une durée ou des étapes)." }, 400);

    const date =
      typeof spec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(spec.date)
        ? spec.date
        : dateInTz(new Date(Date.now() + 86400000), cfg.timezone); // demain par défaut

    const workoutId = await pushRunningWorkout(token, payload, date);
    if (!workoutId) throw new Error("Garmin n'a pas confirmé la création de la séance.");

    return json({ pushed: 1, garminWorkoutId: workoutId, scheduled_date: date });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
