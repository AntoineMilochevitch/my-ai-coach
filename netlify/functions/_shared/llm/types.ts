/**
 * Abstraction multi-provider (Gemini / Anthropic / OpenAI). Côté serveur.
 * Tous les clients exposent la même interface : generate (texte), generateJSON
 * (sortie structurée) et stream (SSE). Chaque appel renvoie l'usage en tokens
 * pour le suivi du coût.
 */
export type Provider = "gemini" | "anthropic" | "openai";

export interface TokenUsage {
  in: number; // tokens d'entrée (prompt + contexte)
  out: number; // tokens de sortie (réponse + réflexion éventuelle)
}

export interface GenResult {
  text: string;
  usage: TokenUsage;
  finishReason?: string;
}

/** Tour de conversation neutre (converti au format de chaque provider). */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface GenerateOpts {
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number; // Gemini 2.5 uniquement
  signal?: AbortSignal;
}

export interface StreamChunk {
  text?: string;
  usage?: TokenUsage; // émis une fois en fin de flux
}

export interface LlmClient {
  provider: Provider;
  model: string;
  generate(system: string, userText: string, opts?: GenerateOpts): Promise<GenResult>;
  generateJSON<T = unknown>(
    system: string,
    userText: string,
    schema: Record<string, unknown> | null,
    opts?: GenerateOpts,
  ): Promise<{ data: T; usage: TokenUsage }>;
  stream(
    system: string,
    turns: ChatTurn[],
    opts?: GenerateOpts,
  ): Promise<AsyncGenerator<StreamChunk>>;
}

/** Sortie tronquée par le plafond de tokens : le caller peut réessayer plus petit. */
export class MaxTokensError extends Error {
  constructor(msg = "Sortie tronquée (MAX_TOKENS)") {
    super(msg);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 503, 529]);

/** POST avec retry exponentiel court sur surcharge temporaire. */
export async function fetchRetry(
  url: string,
  init: RequestInit,
  retries = 2,
): Promise<Response> {
  let resp!: Response;
  for (let attempt = 0; attempt <= retries; attempt++) {
    resp = await fetch(url, init);
    if (resp.ok) return resp;
    if (RETRYABLE.has(resp.status) && attempt < retries) {
      await sleep(700 * (attempt + 1));
      continue;
    }
    return resp; // le caller lit le corps d'erreur
  }
  return resp;
}

/** Découpe un flux SSE en payloads "data:" (ignore [DONE] et les lignes vides). */
export async function* sseLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (p && p !== "[DONE]") yield p;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

/** Extraction robuste d'un objet JSON depuis une réponse LLM (barrières md, bruit). */
export function extractJson<T = unknown>(raw: string): T {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    /* tente l'extraction de l'objet/tableau englobant */
  }
  const candidates: [number, number][] = [
    [text.indexOf("{"), text.lastIndexOf("}")],
    [text.indexOf("["), text.lastIndexOf("]")],
  ];
  for (const [s, e] of candidates) {
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(text.slice(s, e + 1)) as T;
      } catch {
        /* essaie le candidat suivant */
      }
    }
  }
  throw new Error(`Réponse JSON invalide (${text.length} car.) : ${text.slice(0, 150)}`);
}
