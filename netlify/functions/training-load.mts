/**
 * Function : training-load — équilibre de charge (ACWR aiguë/chronique) de
 * l'athlète, calculé depuis activities.training_load. Aucun appel IA.
 *
 * POST {}  + Authorization: Bearer <jwt>  -> LoadBalance | {}
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { trainingLoad } from "./_shared/training-load.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const balance = await trainingLoad(sb, user.id);
    return json(balance ?? {});
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
