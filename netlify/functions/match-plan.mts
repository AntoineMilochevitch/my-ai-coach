/**
 * Function : match-plan — rapproche les séances du plan actif avec les activités
 * réalisées (done) et marque les séances passées non faites (missed).
 *
 * POST {}  + Authorization: Bearer <jwt>  -> { matched, missed }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { matchPlanForUser } from "./_shared/plan-match.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const res = await matchPlanForUser(sb, user.id);
    return json(res);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
