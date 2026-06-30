/**
 * Fabrique du client LLM selon le provider configuré, AVEC repli automatique de
 * modèle : si le modèle choisi atteint sa limite de débit/quota (429) ou est
 * indisponible (403/404), on bascule vers le modèle suivant de la liste de repli
 * du même provider. Transparent pour tous les appelants.
 */
import type { LlmClient, Provider } from "./types.ts";
import { geminiClient } from "./gemini.ts";
import { anthropicClient } from "./anthropic.ts";
import { openaiClient } from "./openai.ts";

export type { LlmClient, Provider, ChatTurn, TokenUsage } from "./types.ts";
export { MaxTokensError } from "./types.ts";

// Modèles de repli par provider (du plus capable/économe au plus léger). Le
// modèle choisi par l'utilisateur est toujours essayé en premier.
const FALLBACKS: Record<Provider, string[]> = {
  gemini: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o-mini", "gpt-4o"],
};

function makeRaw(provider: Provider, apiKey: string, model: string): LlmClient {
  switch (provider) {
    case "anthropic":
      return anthropicClient(apiKey, model);
    case "openai":
      return openaiClient(apiKey, model);
    default:
      return geminiClient(apiKey, model);
  }
}

/** Limite de débit / quota atteint. */
export function isRateLimit(err: unknown): boolean {
  const m = (err as Error)?.message ?? "";
  return /\b429\b|resource_exhausted|rate.?limit|quota|exhausted|overloaded|\b529\b/i.test(m);
}

/** Erreur justifiant d'essayer un AUTRE modèle (limite atteinte ou modèle indisponible). */
function shouldFallback(err: unknown): boolean {
  const m = (err as Error)?.message ?? "";
  return isRateLimit(err) || /\b403\b|\b404\b|not found|unavailable|unsupported/i.test(m);
}

export function getLlm(provider: Provider, apiKey: string, model: string): LlmClient {
  const ordered = [model, ...(FALLBACKS[provider] ?? []).filter((m) => m !== model)];
  const clients = ordered.map((m) => makeRaw(provider, apiKey, m));

  async function run<T>(fn: (c: LlmClient) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < clients.length; i++) {
      try {
        return await fn(clients[i]);
      } catch (e) {
        lastErr = e;
        if (shouldFallback(e) && i < clients.length - 1) continue; // modèle suivant
        throw e;
      }
    }
    throw lastErr;
  }

  return {
    provider,
    model,
    generate: (s, u, o) => run((c) => c.generate(s, u, o)),
    generateJSON: (s, u, sc, o) => run((c) => c.generateJSON(s, u, sc, o)),
    stream: (s, t, o) => run((c) => c.stream(s, t, o)),
  };
}
