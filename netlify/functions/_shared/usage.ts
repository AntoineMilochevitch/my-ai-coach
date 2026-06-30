/**
 * Quotas IA par utilisateur (anti-abus / maîtrise du coût) + journalisation des
 * tokens consommés. S'appuie sur la table ai_usage et la fonction bump_ai_usage
 * (migration 0008). Les limites sont volontairement généreuses : le but est
 * d'empêcher l'emballement, pas de brider l'usage normal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./supabase.ts";
import type { TokenUsage } from "./llm/index.ts";

export type UsageKind = "chat" | "analyze" | "nutrition" | "plan" | "embed" | "estimate";

const LIMITS: Record<UsageKind, number> = {
  chat: 200,
  analyze: 30,
  nutrition: 30,
  plan: 12,
  embed: 5000,
  estimate: 150,
};

/** Jour UTC (cohérent avec le défaut de la colonne ai_usage.day). */
function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lève 429 si le quota du jour est atteint pour ce type d'appel. */
export async function checkQuota(
  sb: SupabaseClient,
  userId: string,
  kind: UsageKind,
): Promise<void> {
  const limit = LIMITS[kind];
  const { data } = await sb
    .from("ai_usage")
    .select("count")
    .eq("user_id", userId)
    .eq("day", utcDay())
    .eq("kind", kind)
    .maybeSingle();
  if ((data?.count ?? 0) >= limit)
    throw new HttpError(
      429,
      `Limite quotidienne atteinte pour « ${kind} » (${limit}/jour). Réessaie demain.`,
    );
}

/** Incrémente le compteur et cumule les tokens (best-effort, jamais bloquant). */
export async function recordUsage(
  sb: SupabaseClient,
  userId: string,
  kind: UsageKind,
  usage?: TokenUsage | null,
): Promise<void> {
  try {
    await sb.rpc("bump_ai_usage", {
      p_user_id: userId,
      p_kind: kind,
      p_tokens_in: usage?.in ?? 0,
      p_tokens_out: usage?.out ?? 0,
    });
  } catch {
    /* la télémétrie d'usage ne doit jamais faire échouer une requête */
  }
}
