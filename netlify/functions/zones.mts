/**
 * Function : zones — zones perso de FC et d'allure de l'athlète, calculées à la
 * volée depuis ses données (FCmax mesurée, FC repos, VO2max, âge). Aucun appel IA.
 *
 * POST {}  + Authorization: Bearer <jwt>  -> Zones | null
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { athleteZones } from "./_shared/zones.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const zones = await athleteZones(sb, user.id);
    return json(zones ?? {});
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
