/**
 * Function : garmin-login (étape 1 de la connexion Garmin sur le site).
 * POST { email, password }  + Authorization: Bearer <jwt supabase>
 *  -> { status: "connected" }                       si pas de MFA
 *  -> { status: "mfa_required", sessionId, mfaMethod } sinon (appeler garmin-mfa ensuite)
 *
 * Les identifiants Garmin ne sont JAMAIS stockés ni journalisés : ils servent
 * uniquement à obtenir les tokens, qui sont chiffrés en base.
 */
import { login, exchangeServiceTicket } from "./_shared/garmin/auth.ts";
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { encrypt } from "./_shared/crypto.ts";
import { storeTokens, setConnected } from "./_shared/garmin/tokens.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const { email, password } = await req.json().catch(() => ({}));
    if (!email || !password)
      return json({ error: "email et password requis" }, 400);

    const result = await login(email, password);

    if (result.type === "mfa_required") {
      // On persiste la session MFA complète (flow + cookies + CSRF/référent).
      const payload_enc = encrypt(JSON.stringify(result.session));
      const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { data, error } = await sb
        .from("garmin_login_sessions")
        .insert({ user_id: user.id, payload_enc, expires_at })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await sb
        .from("garmin_accounts")
        .upsert({ user_id: user.id, status: "mfa_pending" }, { onConflict: "user_id" });
      return json({
        status: "mfa_required",
        sessionId: data.id,
        mfaMethod: result.mfaMethod,
      });
    }

    const tokens = await exchangeServiceTicket(result.ticket, result.serviceUrl);
    await storeTokens(sb, user.id, tokens);
    await setConnected(sb, user.id);
    return json({ status: "connected" });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 400);
  }
};
