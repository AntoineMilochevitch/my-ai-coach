/**
 * Function PLANIFIÉE (cron) : scheduled-sync — synchronise automatiquement les
 * nouvelles activités Garmin de tous les comptes connectés et met à jour le
 * rapprochement du plan. Tourne toutes les heures.
 *
 * Pas de JWT : utilise le service_role et les tokens chiffrés stockés.
 */
import { serviceClient } from "./_shared/supabase.ts";
import { loadTokens, storeTokens } from "./_shared/garmin/tokens.ts";
import { syncGarmin } from "./_shared/garmin/sync.ts";
import { matchPlanForUser } from "./_shared/plan-match.ts";

export const config = { schedule: "@hourly" };

export default async (): Promise<Response> => {
  const sb = serviceClient();
  const { data: rows } = await sb.from("garmin_tokens").select("user_id");
  let synced = 0;

  for (const row of rows ?? []) {
    const userId = row.user_id as string;
    try {
      const tokens = await loadTokens(sb, userId);
      if (!tokens) continue;
      // Fenêtre courte : on ne récupère que le récent (sync fréquente).
      const result = await syncGarmin(sb, userId, tokens, { activityDays: 14, dailyDays: 3 });
      if (result.refreshed) await storeTokens(sb, userId, result.tokens);
      await sb.from("garmin_accounts").upsert(
        {
          user_id: userId,
          status: "connected",
          last_sync_at: new Date().toISOString(),
          garmin_user_id: result.displayName,
          last_error: null,
        },
        { onConflict: "user_id" },
      );
      await matchPlanForUser(sb, userId);
      synced++;
    } catch (err) {
      console.error(`scheduled-sync user ${userId}:`, (err as Error).message);
      await sb
        .from("garmin_accounts")
        .upsert(
          { user_id: userId, status: "error", last_error: (err as Error).message },
          { onConflict: "user_id" },
        )
        .then(
          () => {},
          () => {},
        );
    }
  }

  return new Response(JSON.stringify({ synced }), {
    headers: { "content-type": "application/json" },
  });
};
