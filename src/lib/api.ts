/**
 * Appels aux Netlify Functions. Le JWT Supabase de l'utilisateur est joint en
 * en-tête Authorization ; la Function le vérifie côté serveur.
 */
import { supabase } from "./supabase";

async function post<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Erreur ${res.status}`);
  return payload as T;
}

export type LoginResponse =
  | { status: "connected" }
  | { status: "mfa_required"; sessionId: string; mfaMethod: string };

export const garminLogin = (email: string, password: string) =>
  post<LoginResponse>("garmin-login", { email, password });

export const garminMfa = (sessionId: string, code: string) =>
  post<{ status: "connected" }>("garmin-mfa", { sessionId, code });

export const garminSync = (opts?: { activityDays?: number; dailyDays?: number }) =>
  post<{ status: "ok"; counts: { activities: number; dailyMetrics: number; sleep: number } }>(
    "garmin-sync",
    opts ?? {},
  );

export const aiAnalyze = (days?: number) =>
  post<{ content_md: string; created_at: string }>("ai-analyze", { days });
