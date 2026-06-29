/**
 * Moteur d'authentification Garmin Connect — portage TypeScript de
 * python-garminconnect (garminconnect/client.py).
 *
 * Stratégie résiliente (login()) :
 *   1. Flux "mobile iOS"  — 100 % JSON, rapide. Tenté en premier.
 *   2. Flux "SSO widget"  — repli sur 429/blocage du mobile. Bucket de
 *      rate-limit différent (formulaire HTML), délai anti-WAF court (~3-5 s)
 *      compatible avec le timeout 10 s des Functions.
 *
 * Étapes communes : login → (MFA) → service ticket → échange DI (access +
 * refresh tokens) → appels API Bearer sur connectapi.garmin.com.
 *
 * Sans dépendance (ni Supabase ni Netlify) : réutilisable par les Functions et
 * le script de spike.
 */

// --- Constantes ---
const SSO = "https://sso.garmin.com";
const SSO_BASE = `${SSO}/sso`;
const SSO_EMBED = `${SSO_BASE}/embed`;
const CONNECT_API = "https://connectapi.garmin.com";
const DI_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const DI_GRANT_TYPE =
  "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket";

const IOS_SSO_CLIENT_ID = "GCM_IOS_DARK";
const IOS_SERVICE_URL = "https://mobile.integration.garmin.com/gcm/ios";
const IOS_LOGIN_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DI_CLIENT_IDS = [
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI",
  "GARMIN_CONNECT_MOBILE_IOS_DI",
];

const NATIVE_API_UA = "GCM-Android-5.23";
const NATIVE_X_GARMIN_UA =
  "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; " +
  "Android/33; Dalvik/2.1.0";

// Délai anti-WAF du flux widget (borné pour tenir dans le timeout 10 s).
const WIDGET_DELAY_MIN_MS = 2500;
const WIDGET_DELAY_MAX_MS = 5000;

const CSRF_RE = /name="_csrf"\s+value="([^"]+)"/;
const TITLE_RE = /<title>(.+?)<\/title>/;
const TICKET_RE = /\?ticket=(ST-[^"&\s]+)/;

// --- Types ---
export interface GarminTokens {
  accessToken: string;
  refreshToken: string | null;
  clientId: string;
}

/** Données persistées (chiffrées) entre l'appel login et l'appel MFA. */
export type MfaSession =
  | { flow: "mobile"; cookie: string; mfaMethod: string }
  | { flow: "widget"; cookie: string; csrf: string; referer: string; serviceUrl: string };

export type LoginResult =
  | { type: "success"; ticket: string; serviceUrl: string }
  | { type: "mfa_required"; flow: "mobile" | "widget"; mfaMethod: string; session: MfaSession };

export class GarminAuthError extends Error {}
export class GarminRateLimitError extends Error {}
export class GarminConnectionError extends Error {}

const RATE_LIMIT_MSG =
  "Trop de tentatives — Garmin limite ton IP. Attends ~15-30 min puis réessaie UNE fois.";

// --- Helpers ---
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nativeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": NATIVE_API_UA,
    "X-Garmin-User-Agent": NATIVE_X_GARMIN_UA,
    "X-Garmin-Paired-App-Version": "10861",
    "X-Garmin-Client-Platform": "Android",
    "X-App-Ver": "10861",
    "X-Lang": "en",
    "X-GCExperience": "GC5",
    "Accept-Language": "en-US,en;q=0.9",
    ...extra,
  };
}

function basicAuth(clientId: string): string {
  return "Basic " + Buffer.from(`${clientId}:`).toString("base64");
}

/** Cookie jar minimal : accumule les Set-Cookie et produit un en-tête Cookie. */
class CookieJar {
  private jar = new Map<string, string>();
  addFromResponse(resp: Response): void {
    const set = (resp.headers as any).getSetCookie?.() ?? [];
    for (const c of set as string[]) {
      const pair = c.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/**
 * fetch qui suit les redirections manuellement en accumulant les cookies à
 * chaque saut (les Set-Cookie intermédiaires sont sinon perdus par fetch).
 */
async function fetchJar(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit },
  jar: CookieJar,
  maxRedirects = 5,
): Promise<{ resp: Response; body: string; finalUrl: string }> {
  let current = url;
  let method = init.method ?? "GET";
  let body = init.body;
  for (let i = 0; i <= maxRedirects; i++) {
    const cookie = jar.header();
    const resp = await fetch(current, {
      method,
      headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
      body,
      redirect: "manual",
    });
    jar.addFromResponse(resp);
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return { resp, body: await resp.text(), finalUrl: current };
      current = new URL(loc, current).toString();
      method = "GET";
      body = undefined; // une redirection devient un GET sans corps
      continue;
    }
    return { resp, body: await resp.text(), finalUrl: current };
  }
  throw new GarminConnectionError("Trop de redirections (widget)");
}

function collectCookies(resp: Response): string {
  const raw = (resp.headers as any).getSetCookie?.() ?? [];
  return (raw as string[])
    .map((c) => c.split(";")[0]?.trim())
    .filter((p): p is string => Boolean(p))
    .join("; ");
}

export function extractClientIdFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return payload.client_id ? String(payload.client_id) : null;
  } catch {
    return null;
  }
}

export function tokenExpiresSoon(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    const exp = payload.exp;
    return Boolean(exp && Date.now() / 1000 > Number(exp) - 900);
  } catch {
    return false;
  }
}

// =====================================================================
//  Orchestration résiliente
// =====================================================================
export async function login(email: string, password: string): Promise<LoginResult> {
  try {
    return await mobileLogin(email, password);
  } catch (err) {
    if (err instanceof GarminAuthError) throw err; // identifiants faux : inutile d'insister
    // 429 / blocage Cloudflare / captcha → on tente le flux widget (autre bucket).
    return await widgetLogin(email, password);
  }
}

export async function completeMfa(
  session: MfaSession,
  code: string,
): Promise<{ ticket: string; serviceUrl: string }> {
  if (session.flow === "widget") return completeMfaWidget(session, code);
  return completeMfaMobile(session, code);
}

// =====================================================================
//  Flux 1 — mobile iOS (JSON)
// =====================================================================
export async function mobileLogin(email: string, password: string): Promise<LoginResult> {
  const url = new URL(`${SSO}/mobile/api/login`);
  url.searchParams.set("clientId", IOS_SSO_CLIENT_ID);
  url.searchParams.set("locale", "en-US");
  url.searchParams.set("service", IOS_SERVICE_URL);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": IOS_LOGIN_UA,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: SSO,
    },
    body: JSON.stringify({ username: email, password, rememberMe: true, captchaToken: "" }),
  });

  if (resp.status === 429) throw new GarminRateLimitError(RATE_LIMIT_MSG);
  if (resp.status === 403)
    throw new GarminConnectionError("Login mobile 403 (Cloudflare) — repli widget");

  let res: any;
  try {
    res = await resp.json();
  } catch {
    throw new GarminConnectionError(`Login mobile: réponse non-JSON (HTTP ${resp.status})`);
  }

  const t = res?.responseStatus?.type;
  if (t === "MFA_REQUIRED") {
    const mfaMethod = res?.customerMfaInfo?.mfaLastMethodUsed ?? "email";
    return {
      type: "mfa_required",
      flow: "mobile",
      mfaMethod,
      session: { flow: "mobile", cookie: collectCookies(resp), mfaMethod },
    };
  }
  if (t === "SUCCESSFUL")
    return { type: "success", ticket: res.serviceTicketId, serviceUrl: IOS_SERVICE_URL };
  if (t === "INVALID_USERNAME_PASSWORD")
    throw new GarminAuthError("Identifiant ou mot de passe invalide");
  if (res?.error?.["status-code"] === "429") throw new GarminRateLimitError(RATE_LIMIT_MSG);
  if (t === "CAPTCHA_REQUIRED")
    throw new GarminConnectionError("Login mobile: CAPTCHA requis — repli widget");
  throw new GarminConnectionError(`Login mobile échoué: ${JSON.stringify(res)}`);
}

async function completeMfaMobile(
  session: Extract<MfaSession, { flow: "mobile" }>,
  code: string,
): Promise<{ ticket: string; serviceUrl: string }> {
  const url = new URL(`${SSO}/mobile/api/mfa/verifyCode`);
  url.searchParams.set("clientId", IOS_SSO_CLIENT_ID);
  url.searchParams.set("locale", "en-US");
  url.searchParams.set("service", IOS_SERVICE_URL);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": IOS_LOGIN_UA,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: SSO,
      Cookie: session.cookie,
    },
    body: JSON.stringify({
      mfaMethod: session.mfaMethod,
      mfaVerificationCode: code,
      rememberMyBrowser: true,
      reconsentList: [],
      mfaSetup: false,
    }),
  });
  if (resp.status === 429) throw new GarminRateLimitError("MFA verify 429");
  let res: any;
  try {
    res = await resp.json();
  } catch {
    throw new GarminConnectionError(`MFA verify: non-JSON (HTTP ${resp.status})`);
  }
  if (res?.responseStatus?.type === "SUCCESSFUL")
    return { ticket: res.serviceTicketId, serviceUrl: IOS_SERVICE_URL };
  throw new GarminAuthError(`Vérification MFA échouée: ${JSON.stringify(res)}`);
}

// =====================================================================
//  Flux 2 — SSO widget (HTML form)
// =====================================================================
function widgetSigninParams(): URLSearchParams {
  return new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    gauthHost: SSO_EMBED,
    service: SSO_EMBED,
    source: SSO_EMBED,
    redirectAfterAccountLoginUrl: SSO_EMBED,
    redirectAfterAccountCreationUrl: SSO_EMBED,
  });
}

export async function widgetLogin(email: string, password: string): Promise<LoginResult> {
  const jar = new CookieJar();
  const embedParams = new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    gauthHost: SSO_BASE,
  });
  const signinParams = widgetSigninParams();
  const signinUrl = `${SSO_BASE}/signin?${signinParams}`;
  const baseHeaders = { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" };

  // Étape 1 : GET embed (cookies de session)
  const embed = await fetchJar(
    `${SSO_EMBED}?${embedParams}`,
    { headers: { ...baseHeaders, Accept: "text/html,*/*" } },
    jar,
  );
  if (embed.resp.status === 429) throw new GarminRateLimitError(RATE_LIMIT_MSG);
  if (embed.resp.status >= 400)
    throw new GarminConnectionError(`Widget embed HTTP ${embed.resp.status}`);

  // Étape 2 : GET signin → token CSRF
  const signin = await fetchJar(
    signinUrl,
    { headers: { ...baseHeaders, Accept: "text/html,*/*", Referer: SSO_EMBED } },
    jar,
  );
  if (signin.resp.status === 429) throw new GarminRateLimitError(RATE_LIMIT_MSG);
  const csrf = CSRF_RE.exec(signin.body)?.[1];
  if (!csrf) throw new GarminConnectionError("Widget: token CSRF introuvable");

  // Étape 3 : délai anti-WAF
  await sleep(WIDGET_DELAY_MIN_MS + Math.floor(Math.random() * (WIDGET_DELAY_MAX_MS - WIDGET_DELAY_MIN_MS)));

  // Étape 4 : POST identifiants
  const post = await fetchJar(
    signinUrl,
    {
      method: "POST",
      headers: {
        ...baseHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: signin.finalUrl,
      },
      body: new URLSearchParams({ username: email, password, embed: "true", _csrf: csrf }),
    },
    jar,
  );
  if (post.resp.status === 429) throw new GarminRateLimitError(RATE_LIMIT_MSG);

  const title = (TITLE_RE.exec(post.body)?.[1] ?? "").toLowerCase();
  if (["bad gateway", "service unavailable", "cloudflare", "502", "503"].some((h) => title.includes(h)))
    throw new GarminConnectionError(`Widget: erreur serveur '${title}'`);
  if (["locked", "invalid", "incorrect", "account error"].some((h) => title.includes(h)))
    throw new GarminAuthError(`Authentification widget échouée: '${title}'`);
  if (title.includes("unable to sign in") || title.includes("unable to login"))
    throw new GarminConnectionError(`Widget: compte restreint '${title}'`);

  if (title.includes("mfa") || title.includes("authentication application")) {
    const mfaCsrf = CSRF_RE.exec(post.body)?.[1] ?? csrf;
    return {
      type: "mfa_required",
      flow: "widget",
      mfaMethod: "email",
      session: {
        flow: "widget",
        cookie: jar.header(),
        csrf: mfaCsrf,
        referer: post.finalUrl,
        serviceUrl: SSO_EMBED,
      },
    };
  }

  if (title !== "success")
    throw new GarminConnectionError(`Widget: titre inattendu '${title}'`);
  const ticket = TICKET_RE.exec(post.body)?.[1];
  if (!ticket) throw new GarminConnectionError("Widget: service ticket introuvable");
  return { type: "success", ticket, serviceUrl: SSO_EMBED };
}

async function completeMfaWidget(
  session: Extract<MfaSession, { flow: "widget" }>,
  code: string,
): Promise<{ ticket: string; serviceUrl: string }> {
  const jar = new CookieJar();
  // Réinjecte les cookies persistés.
  (jar as any).jar = new Map(
    session.cookie.split("; ").filter(Boolean).map((p) => {
      const eq = p.indexOf("=");
      return [p.slice(0, eq), p.slice(eq + 1)];
    }),
  );
  const params = widgetSigninParams();
  const out = await fetchJar(
    `${SSO}/sso/verifyMFA/loginEnterMfaCode?${params}`,
    {
      method: "POST",
      headers: {
        "User-Agent": DESKTOP_UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: session.referer,
      },
      body: new URLSearchParams({
        "mfa-code": code,
        embed: "true",
        _csrf: session.csrf,
        fromPage: "setupEnterMfaCode",
      }),
    },
    jar,
  );
  if (out.resp.status === 429) throw new GarminRateLimitError("MFA widget 429");
  const title = TITLE_RE.exec(out.body)?.[1] ?? "";
  if (title !== "Success") throw new GarminAuthError(`MFA widget échouée: ${title}`);
  const ticket = TICKET_RE.exec(out.body)?.[1];
  if (!ticket) throw new GarminAuthError("MFA widget: service ticket introuvable");
  return { ticket, serviceUrl: SSO_EMBED };
}

// =====================================================================
//  Échange / rafraîchissement de tokens, appels API
// =====================================================================
export async function exchangeServiceTicket(
  ticket: string,
  serviceUrl: string = IOS_SERVICE_URL,
): Promise<GarminTokens> {
  let lastBody = "";
  for (const clientId of DI_CLIENT_IDS) {
    const resp = await fetch(DI_TOKEN_URL, {
      method: "POST",
      headers: nativeHeaders({
        Authorization: basicAuth(clientId),
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      }),
      body: new URLSearchParams({
        client_id: clientId,
        service_ticket: ticket,
        grant_type: DI_GRANT_TYPE,
        service_url: serviceUrl,
      }),
    });
    if (resp.status === 429) throw new GarminRateLimitError("Échange ticket rate-limité");
    if (!resp.ok) {
      lastBody = `${resp.status} ${(await resp.text()).slice(0, 200)}`;
      continue;
    }
    const data: any = await resp.json();
    if (data.access_token) {
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        clientId: extractClientIdFromJwt(data.access_token) ?? clientId,
      };
    }
  }
  throw new GarminAuthError(`Échange ticket échoué (tous client_id): ${lastBody}`);
}

export async function refreshTokens(tokens: GarminTokens): Promise<GarminTokens> {
  if (!tokens.refreshToken) throw new GarminAuthError("Pas de refresh_token");
  const resp = await fetch(DI_TOKEN_URL, {
    method: "POST",
    headers: nativeHeaders({
      Authorization: basicAuth(tokens.clientId),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    }),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: tokens.clientId,
      refresh_token: tokens.refreshToken,
    }),
  });
  if (!resp.ok)
    throw new GarminAuthError(`Refresh échoué: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
  const data: any = await resp.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    clientId: extractClientIdFromJwt(data.access_token) ?? tokens.clientId,
  };
}

export async function connectApi<T = any>(accessToken: string, path: string): Promise<T> {
  const resp = await fetch(`${CONNECT_API}/${path.replace(/^\//, "")}`, {
    headers: nativeHeaders({ Authorization: `Bearer ${accessToken}`, Accept: "application/json" }),
  });
  if (resp.status === 401 || resp.status === 403)
    throw new GarminAuthError(`API a rejeté le token (HTTP ${resp.status})`);
  if (!resp.ok) throw new GarminConnectionError(`API erreur ${resp.status} sur ${path}`);
  if (resp.status === 204) return {} as T;
  return (await resp.json()) as T;
}
