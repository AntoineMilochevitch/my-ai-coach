/**
 * Function : garmin-sync.
 * POST { activityDays?, dailyDays? }  + Authorization: Bearer <jwt supabase>
 *  -> { status: "ok", counts: { activities, dailyMetrics, sleep } }
 *
 * Recharge les tokens chiffrés, synchronise les données récentes vers Supabase,
 * persiste les tokens si rafraîchis, et met à jour le statut du compte Garmin.
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { loadTokens, storeTokens } from "./_shared/garmin/tokens.ts";
import { syncGarmin } from "./_shared/garmin/sync.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);

  let ctx: Awaited<ReturnType<typeof requireUser>> | null = null;
  try {
    ctx = await requireUser(req);
    const { user, sb } = ctx;

    const tokens = await loadTokens(sb, user.id);
    if (!tokens) return json({ error: "Garmin non connecté" }, 400);

    const body = await req.json().catch(() => ({}));
    const result = await syncGarmin(sb, user.id, tokens, body);

    if (result.refreshed) await storeTokens(sb, user.id, result.tokens);

    await sb.from("garmin_accounts").upsert(
      {
        user_id: user.id,
        status: "connected",
        last_sync_at: new Date().toISOString(),
        garmin_user_id: result.displayName,
        last_error: null,
      },
      { onConflict: "user_id" },
    );

    return json({ status: "ok", counts: result.counts });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    // Trace l'erreur sur le compte pour diagnostic côté UI.
    if (ctx) {
      await ctx.sb
        .from("garmin_accounts")
        .upsert(
          { user_id: ctx.user.id, status: "error", last_error: (err as Error).message },
          { onConflict: "user_id" },
        )
        .then(() => {});
    }
    return json({ error: (err as Error).message }, 500);
  }
};
