/**
 * Function : garmin-mfa (étape 2 — vérification du code MFA).
 * POST { sessionId, code }  + Authorization: Bearer <jwt supabase>
 *  -> { status: "connected" }
 *
 * Recharge la session MFA chiffrée (cookie + méthode) stockée par garmin-login,
 * finalise le login, échange le ticket contre des tokens, puis nettoie la session.
 */
import { completeMfa, exchangeServiceTicket, type MfaSession } from "./_shared/garmin/auth.ts";
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { decrypt } from "./_shared/crypto.ts";
import { storeTokens, setConnected } from "./_shared/garmin/tokens.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const { sessionId, code } = await req.json().catch(() => ({}));
    if (!sessionId || !code)
      return json({ error: "sessionId et code requis" }, 400);

    const { data: sess, error } = await sb
      .from("garmin_login_sessions")
      .select("id, payload_enc, expires_at")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sess) return json({ error: "Session MFA introuvable" }, 404);
    if (new Date(sess.expires_at) < new Date()) {
      await sb.from("garmin_login_sessions").delete().eq("id", sessionId);
      return json({ error: "Session MFA expirée, recommence la connexion" }, 410);
    }

    const session = JSON.parse(decrypt(sess.payload_enc)) as MfaSession;
    const { ticket, serviceUrl } = await completeMfa(session, String(code));
    const tokens = await exchangeServiceTicket(ticket, serviceUrl);

    await storeTokens(sb, user.id, tokens);
    await setConnected(sb, user.id);
    await sb.from("garmin_login_sessions").delete().eq("id", sessionId);

    return json({ status: "connected" });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 400);
  }
};
