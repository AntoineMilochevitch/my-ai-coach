/**
 * Function : send-auth-email — "Send Email Hook" de Supabase Auth.
 * Supabase POSTe ici chaque e-mail d'authentification (inscription, réinit. mot de
 * passe, magic link, changement d'e-mail…) ; on le rend au thème du site et on
 * l'envoie via Resend. La requête est signée (standardwebhooks) et vérifiée.
 *
 * Config Supabase : Auth > Hooks > Send Email = URL de cette fonction + secret.
 * Env Netlify : RESEND_API_KEY, RESEND_FROM, SEND_EMAIL_HOOK_SECRET, SUPABASE_URL.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { renderAuthEmail } from "./_shared/auth-email.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Vérifie la signature standardwebhooks (headers webhook-id/timestamp/signature). */
function verifySignature(
  secretRaw: string,
  id: string | null,
  ts: string | null,
  sigHeader: string | null,
  body: string,
): boolean {
  if (!id || !ts || !sigHeader) return false;
  // Rejet des requêtes trop anciennes (anti-rejeu, tolérance 5 min).
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;

  let s = secretRaw.trim();
  if (s.startsWith("v1,")) s = s.slice(3);
  s = s.replace(/^whsec_/, "");
  const key = Buffer.from(s, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  const expBuf = Buffer.from(expected);

  return sigHeader.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    if (!sig) return false;
    const b = Buffer.from(sig);
    return b.length === expBuf.length && timingSafeEqual(b, expBuf);
  });
}

function verifyType(action: string): string {
  return action.startsWith("email_change") ? "email_change" : action;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);

  const hookSecret = process.env.SEND_EMAIL_HOOK_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "my-ai-coach <onboarding@resend.dev>";
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!hookSecret) return json({ error: { message: "SEND_EMAIL_HOOK_SECRET manquant" } }, 500);
  if (!resendKey) return json({ error: { message: "RESEND_API_KEY manquant" } }, 500);

  const raw = await req.text();
  const h = req.headers;
  const ok = verifySignature(
    hookSecret,
    h.get("webhook-id"),
    h.get("webhook-timestamp"),
    h.get("webhook-signature"),
    raw,
  );
  if (!ok) return json({ error: { message: "Signature invalide" } }, 401);

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: { message: "Corps JSON invalide" } }, 400);
  }

  const email: string | undefined = payload?.user?.email;
  const ed = payload?.email_data ?? {};
  const action: string = ed.email_action_type ?? "signup";
  if (!email) return json({ error: { message: "email manquant" } }, 400);

  // Lien de vérification (hébergé par Supabase Auth) ; sinon code OTP (reauthentication).
  let url: string | null = null;
  if (ed.token_hash && supabaseUrl) {
    const redirect = encodeURIComponent(ed.redirect_to ?? ed.site_url ?? "");
    url = `${supabaseUrl}/auth/v1/verify?token=${ed.token_hash}&type=${verifyType(action)}&redirect_to=${redirect}`;
  }

  const { subject, html, text } = renderAuthEmail(action, url, ed.token);

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject, html, text }),
  });

  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    return json({ error: { http_code: resp.status, message: `Resend: ${detail}` } }, 500);
  }
  return json({});
};
