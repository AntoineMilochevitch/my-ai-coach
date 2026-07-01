/**
 * Function : edit-workout — modifie une séance EXISTANTE du plan actif (par date).
 * Régénère les étapes si la description/cible change, et délie la séance de Garmin
 * pour permettre un nouvel envoi.
 *
 * POST { date, changes: { title?, description?, distance_km?, duree_min?, allure?, sessionType? } }
 *  + Authorization: Bearer <jwt>  -> { updated }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { getLlm } from "./_shared/llm/index.ts";
import { generateWorkoutSteps } from "./_shared/workout-gen.ts";
import { recordUsage } from "./_shared/usage.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const date = String(body.date ?? "").trim();
    const changes = body.changes ?? {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return json({ error: "Date de la séance à modifier manquante (AAAA-MM-JJ)." }, 400);

    const { data: plan } = await sb
      .from("training_plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!plan) return json({ error: "Aucun plan actif." }, 400);

    const { data: workouts } = await sb
      .from("plan_workouts")
      .select("id, title, description, session_type, target, steps")
      .eq("plan_id", plan.id)
      .eq("user_id", user.id)
      .eq("scheduled_date", date);
    if (!workouts?.length)
      return json({ error: `Aucune séance le ${date} dans ton plan.` }, 400);

    const cfg = await loadAiConfig(sb, user);
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    let updated = 0;
    for (const w of workouts) {
      const oldTarget: any = w.target ?? {};
      const target = {
        distance_km: changes.distance_km != null ? Number(changes.distance_km) : oldTarget.distance_km ?? null,
        duree_min: changes.duree_min != null ? Number(changes.duree_min) : oldTarget.duree_min ?? null,
        allure: changes.allure ?? oldTarget.allure ?? null,
        zone_fc: oldTarget.zone_fc ?? null,
      };
      const description = changes.description != null ? String(changes.description) : w.description ?? "";
      const sessionType = changes.sessionType ? String(changes.sessionType) : w.session_type ?? "";

      // Régénère les étapes si la description ou les cibles changent.
      let steps = w.steps;
      const changedShape =
        changes.description != null ||
        changes.distance_km != null ||
        changes.duree_min != null ||
        changes.allure != null;
      if (changedShape) {
        const r = await generateWorkoutSteps(llm, {
          description,
          distanceKm: target.distance_km,
          dureeMin: target.duree_min,
          allure: target.allure,
          sessionType,
        });
        await recordUsage(sb, user.id, "plan", r.usage);
        if (r.steps) steps = r.steps;
      }

      const { error } = await sb
        .from("plan_workouts")
        .update({
          title: changes.title ? String(changes.title) : w.title,
          description,
          session_type: sessionType || w.session_type,
          target,
          steps,
          garmin_workout_id: null, // délie : permet un nouvel envoi sur Garmin
        })
        .eq("id", w.id);
      if (!error) updated++;
    }

    return json({ updated });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
