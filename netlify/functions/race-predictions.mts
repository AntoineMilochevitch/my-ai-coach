/**
 * Function : race-predictions — chronos réalistes (5/10/21.1/42.2 km) estimés
 * via le VDOT de l'athlète (VO2max Garmin/synchro, ou meilleure course). Aucun IA.
 *
 * POST {}  + Authorization: Bearer <jwt>  -> Predictions | {}
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { racePredictions } from "./_shared/predict.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const preds = await racePredictions(sb, user.id);
    return json(preds ?? {});
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
