/**
 * Function (BACKGROUND) : create-workout-background — crée UNE séance de course
 * (étapes générées par IA) et l'envoie sur la montre via Garmin. En arrière-plan
 * (pas de limite 10 s → repli de modèle possible). Écrit le résultat dans la
 * conversation (chat_messages) si un conversationId est fourni.
 *
 * POST { spec, conversationId? }  + Authorization: Bearer <jwt>  -> 202
 */
import { requireUser } from "./_shared/supabase.ts";
import { loadTokens, storeTokens } from "./_shared/garmin/tokens.ts";
import { refreshTokens, tokenExpiresSoon, type GarminTokens } from "./_shared/garmin/auth.ts";
import { buildRunningWorkout, pushRunningWorkout } from "./_shared/garmin/workout.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { getLlm } from "./_shared/llm/index.ts";
import { generateWorkoutSteps } from "./_shared/workout-gen.ts";
import { recordUsage } from "./_shared/usage.ts";
import { dateInTz } from "./_shared/dates.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const RUN_TYPES = ["easy", "long", "tempo", "interval", "recovery"];

export default async (req: Request): Promise<Response> => {
  const ok = () => new Response("", { status: 202 });
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  try {
    ctx = await requireUser(req);
  } catch {
    return ok();
  }
  const { user, sb } = ctx;
  const body = await req.json().catch(() => ({}));
  const spec = body.spec ?? {};
  const conversationId: string | null = body.conversationId ?? null;

  const notify = async (content: string) => {
    if (!conversationId) return;
    await (sb as SupabaseClient)
      .from("chat_messages")
      .insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", content })
      .then(
        () => {},
        () => {},
      );
  };

  try {
    const sport = String(spec.sport || "running").toLowerCase();
    const sessionType = String(spec.sessionType || "").toLowerCase();
    const isRun =
      sport.includes("run") || sport.includes("cours") || RUN_TYPES.includes(sessionType);
    if (!isRun) {
      await notify("⚠️ Seules les séances de course peuvent être envoyées sur Garmin pour l'instant.");
      return ok();
    }

    let tokens = await loadTokens(sb, user.id);
    if (!tokens) {
      await notify("⚠️ Garmin non connecté — connecte ton compte dans le Profil.");
      return ok();
    }
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
    if (!payload) {
      await notify("⚠️ Séance non exploitable (précise une distance, une durée ou des étapes).");
      return ok();
    }

    const date =
      typeof spec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(spec.date)
        ? spec.date
        : dateInTz(new Date(Date.now() + 86400000), cfg.timezone);

    const workoutId = await pushRunningWorkout(token, payload, date);
    if (!workoutId) throw new Error("Garmin n'a pas confirmé la création de la séance.");

    await notify(`✅ Séance « ${title} » envoyée sur ta montre pour le ${date}.`);
  } catch (e) {
    await notify(`⚠️ Impossible de créer la séance : ${(e as Error).message.slice(0, 160)}`);
  }
  return ok();
};
