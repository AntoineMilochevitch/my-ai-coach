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

// Analyse de coach EN ARRIÈRE-PLAN (202). Le client interroge ai_analyses (scope 'period').
export const aiAnalyzeBackground = (days?: number) =>
  post<Record<string, never>>("ai-analyze-background", { days });

// Message proactif du coach EN ARRIÈRE-PLAN (202). Le client interroge coach_insights.
export const coachInsightBackground = () =>
  post<Record<string, never>>("coach-insight-background", {});

export type ChatActionKind =
  | "create_plan"
  | "adapt_plan"
  | "add_nutrition"
  | "add_note"
  | "create_workout"
  | "edit_workout"
  | "nutrition_plan"
  | "remember";
export interface ChatAction {
  kind: ChatActionKind;
  args: Record<string, any>;
  summary: string;
  status: "pending" | "applied" | "cancelled";
}

/**
 * Déclenche la génération de la réponse du coach EN ARRIÈRE-PLAN (202 immédiat).
 * Le message utilisateur est déjà inséré côté client ; celui-ci interroge ensuite
 * chat_messages jusqu'à l'apparition de la réponse de l'assistant.
 */
export const chatBackground = (conversationId: string) =>
  post<Record<string, never>>("chat-background", { conversationId });

export type AiProvider = "gemini" | "anthropic" | "openai";

export const indexRag = () =>
  post<{ indexed: number; remaining: number }>("index-rag", {});

/** Indexe le RAG en boucle jusqu'à épuisement (best-effort, non bloquant). */
export async function indexRagAll(maxCalls = 25): Promise<void> {
  for (let i = 0; i < maxCalls; i++) {
    const res = await indexRag().catch(() => null);
    if (!res || res.remaining <= 0) return;
  }
}

export const setAiConfig = (cfg: {
  provider?: AiProvider;
  model?: string;
  apiKey?: string;
}) =>
  post<{
    ok: true;
    provider: AiProvider;
    model: string | null;
    keys: Record<string, boolean>;
  }>("set-ai-config", cfg);

export const listModels = (provider: AiProvider, apiKey?: string) =>
  post<{
    provider: AiProvider;
    models: { id: string; label: string }[];
    key_set: boolean;
  }>("list-models", { provider, apiKey });

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

// Adaptation roulante du plan actif (background, 202 immédiat). Le client suit
// l'avancement via training_plans.last_adapted_at.
export const adaptPlan = () => post<Record<string, never>>("adapt-plan-background", {});

export const pushWorkout = (opts: { planWorkoutId?: string; all?: boolean }) =>
  post<{ pushed: number; errors: string[] }>("garmin-push-workout", opts);

// Crée une séance (IA) et l'envoie sur la montre Garmin, EN ARRIÈRE-PLAN (202).
// Le résultat est écrit dans la conversation (chat_messages).
export const createWorkout = (spec: Record<string, any>, conversationId?: string) =>
  post<Record<string, never>>("create-workout-background", { spec, conversationId });

// Modifie une séance existante du plan (par date), EN ARRIÈRE-PLAN (202).
export const editWorkout = (date: string, changes: Record<string, any>, conversationId?: string) =>
  post<Record<string, never>>("edit-workout-background", { date, changes, conversationId });

// Conseils nutrition EN ARRIÈRE-PLAN (202). Le client interroge ai_analyses (scope 'nutrition').
export const nutritionAdviceBackground = (days?: number) =>
  post<Record<string, never>>("nutrition-advice-background", { days });

// Plan nutrition (repas recommandés) EN ARRIÈRE-PLAN (202). Le client interroge nutrition_plans.
export const nutritionPlanBackground = (constraints?: string, includeInEffort?: boolean) =>
  post<Record<string, never>>("nutrition-plan-background", { constraints, includeInEffort });

export const estimateNutrition = (description: string) =>
  post<{
    label: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  }>("estimate-nutrition", { description });

export const nameConversation = (conversationId: string) =>
  post<{ title: string }>("name-conversation", { conversationId });

export interface Zones {
  hr_max: number | null;
  hr_max_source: string | null;
  resting_hr: number | null;
  vo2max: number | null;
  hr: { method: string; zones: { n: number; label: string; min: number; max: number }[] } | null;
  pace: { method: string; zones: { label: string; pace: string }[] } | null;
  garmin: {
    threshold_pace: string | null;
    lthr: number | null;
    hr_max: number | null;
    has_hr_floors: boolean;
    fetched_at: string | null;
  } | null;
}

// Zones perso (FC + allure), calculées côté serveur depuis les données de l'athlète.
export const getZones = () => post<Zones | Record<string, never>>("zones", {});

// Récupère les zones depuis Garmin Connect EN ARRIÈRE-PLAN (202). Le client
// re-interroge ensuite getZones() pour voir la source « Garmin ».
export const garminZonesRefresh = () =>
  post<Record<string, never>>("garmin-zones-background", {});

export type LoadStatus = "detraining" | "optimal" | "high" | "very_high";
export interface LoadBalance {
  acute_7d: number;
  chronic_weekly: number;
  acwr: number | null;
  status: LoadStatus | null;
  weekly: { start: string; load: number }[];
  trend_pct: number | null;
}

// Équilibre de charge (ACWR), calculé côté serveur depuis training_load.
export const getTrainingLoad = () =>
  post<LoadBalance | Record<string, never>>("training-load", {});

export interface RacePrediction {
  label: string;
  distance_m: number;
  time_s: number;
  pace_s_per_km: number;
}
export interface Predictions {
  vdot: number;
  source: string;
  races: RacePrediction[];
}

// Prédictions de chronos (VDOT), calculées côté serveur.
export const getRacePredictions = () =>
  post<Predictions | Record<string, never>>("race-predictions", {});
