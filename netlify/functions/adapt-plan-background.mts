/**
 * Function (BACKGROUND) : adapt-plan-background — ré-adapte le plan actif (manuel).
 * Détaille/ajuste la fenêtre de semaines à venir selon l'état de forme réel.
 * Renvoie 202 immédiatement ; le client suit l'avancement via training_plans.last_adapted_at.
 */
import { requireUser } from "./_shared/supabase.ts";
import { adaptPlanForUser } from "./_shared/plan-adapt.ts";

export default async (req: Request): Promise<Response> => {
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  try {
    ctx = await requireUser(req);
  } catch {
    return new Response("", { status: 202 });
  }
  const { user, sb } = ctx;
  try {
    await adaptPlanForUser(sb, user, { enforceQuota: true });
  } catch (err) {
    console.error("adapt-plan error:", (err as Error).message);
    // On consigne l'erreur sur le plan actif pour l'afficher côté client.
    await sb
      .from("training_plans")
      .update({ content: { adapt_error: (err as Error).message } })
      .eq("user_id", user.id)
      .eq("status", "active")
      .then(
        () => {},
        () => {},
      );
  }
  return new Response("", { status: 202 });
};
