/**
 * Function (BACKGROUND) : garmin-zones-background — récupère les zones
 * d'entraînement depuis Garmin Connect (FCmax/FC repos, seuils FC & allure, bornes
 * de zones FC) et les stocke dans profiles.garmin_zones. Best-effort : en cas
 * d'échec, on ne casse rien (le calcul maison des zones reste utilisé).
 *
 * POST {}  + Authorization: Bearer <jwt>  -> 202
 */
import { requireUser } from "./_shared/supabase.ts";
import { loadTokens, storeTokens } from "./_shared/garmin/tokens.ts";
import { refreshTokens, tokenExpiresSoon } from "./_shared/garmin/auth.ts";
import { fetchGarminZones } from "./_shared/garmin/zones-fetch.ts";

export default async (req: Request): Promise<Response> => {
  const ok = () => new Response("", { status: 202 });
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  try {
    ctx = await requireUser(req);
  } catch {
    return ok();
  }
  const { user, sb } = ctx;

  try {
    let tokens = await loadTokens(sb, user.id);
    if (!tokens) return ok(); // Garmin non connecté

    if (tokenExpiresSoon(tokens.accessToken)) {
      tokens = await refreshTokens(tokens);
      await storeTokens(sb, user.id, tokens);
    }

    const zones = await fetchGarminZones(tokens.accessToken);
    if (zones) {
      await sb.from("profiles").update({ garmin_zones: zones }).eq("id", user.id);
    }
  } catch (e) {
    console.error("garmin-zones error:", (e as Error).message);
  }
  return ok();
};
