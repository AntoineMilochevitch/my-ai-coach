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

/** Chat en streaming : appelle onChunk au fil des tokens. Renvoie l'id de conversation. */
export async function chatStream(
  message: string,
  conversationId: string | null,
  onChunk: (text: string) => void,
): Promise<{ conversationId: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch("/.netlify/functions/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, conversationId }),
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Erreur ${res.status}`);
  }
  const convId = res.headers.get("x-conversation-id") || conversationId || "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    if (chunk) onChunk(chunk);
  }
  return { conversationId: convId };
}

export const indexRag = () =>
  post<{ indexed: number; remaining: number }>("index-rag", {});

export const setAiConfig = (cfg: {
  geminiKey?: string;
  model?: string;
  provider?: string;
}) =>
  post<{ ok: true; model: string | null; provider: string; gemini_key_set: boolean }>(
    "set-ai-config",
    cfg,
  );

export const listModels = (geminiKey?: string) =>
  post<{ models: { id: string; label: string }[]; gemini_key_set: boolean }>(
    "list-models",
    { geminiKey },
  );

export interface PlanInput {
  mode: "weeks" | "date";
  objective: string;
  targetTime?: string;
  distanceKm?: number;
  elevationM?: number;
  targetDate?: string;
  weeks?: number;
  sessionsPerWeek?: number;
  preferredDays?: number[];
  maxSessionMin?: number;
  level?: string;
  constraints?: string;
}

// Fonction background : renvoie 202 immédiatement, génération en tâche de fond.
// Le client interroge ensuite training_plans (statut generating -> active|error).
export const generatePlan = (input: PlanInput) =>
  post<Record<string, never>>("generate-plan-background", input);

export const matchPlan = () => post<{ matched: number; missed: number }>("match-plan", {});

export const pushWorkout = (opts: { planWorkoutId?: string; all?: boolean }) =>
  post<{ pushed: number; errors: string[] }>("garmin-push-workout", opts);

export const nutritionAdvice = (days?: number) =>
  post<{ content_md: string }>("nutrition-advice", { days });
