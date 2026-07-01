/**
 * Function (BACKGROUND) : edit-workout-background — modifie une séance EXISTANTE
 * du plan actif (par date), régénère les étapes si besoin, et délie la séance de
 * Garmin (nouvel envoi possible). Écrit le résultat dans la conversation.
 *
 * POST { date, changes, conversationId? }  + Authorization: Bearer <jwt>  -> 202
 */
import { requireUser } from "./_shared/supabase.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { getLlm } from "./_shared/llm/index.ts";
import { generateWorkoutSteps } from "./_shared/workout-gen.ts";
import { recordUsage } from "./_shared/usage.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  const date = String(body.date ?? "").trim();
  const changes = body.changes ?? {};
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await notify("⚠️ Date de la séance à modifier manquante (AAAA-MM-JJ).");
      return ok();
    }

    const { data: plan } = await sb
      .from("training_plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!plan) {
      await notify("⚠️ Aucun plan actif.");
      return ok();
    }

    const { data: workouts } = await sb
      .from("plan_workouts")
      .select("id, title, description, session_type, target, steps")
      .eq("plan_id", plan.id)
      .eq("user_id", user.id)
      .eq("scheduled_date", date);
    if (!workouts?.length) {
      await notify(`⚠️ Aucune séance le ${date} dans ton plan.`);
      return ok();
    }

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
          garmin_workout_id: null,
        })
        .eq("id", w.id);
      if (!error) updated++;
    }

    await notify(
      updated
        ? `✅ Séance du ${date} modifiée. Tu peux la renvoyer sur Garmin depuis l'onglet Plan.`
        : `⚠️ La modification du ${date} n'a pas pu être enregistrée.`,
    );
  } catch (e) {
    await notify(`⚠️ Impossible de modifier la séance : ${(e as Error).message.slice(0, 160)}`);
  }
  return ok();
};
