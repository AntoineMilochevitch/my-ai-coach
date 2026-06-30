/** Client Gemini (API REST v1beta). Implémente LlmClient. */
import {
  type LlmClient,
  type GenResult,
  type StreamChunk,
  type TokenUsage,
  MaxTokensError,
  fetchRetry,
  sseLines,
  extractJson,
} from "./types.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function usageOf(meta: any): TokenUsage {
  return {
    in: Number(meta?.promptTokenCount ?? 0),
    out: Number(meta?.candidatesTokenCount ?? 0) + Number(meta?.thoughtsTokenCount ?? 0),
  };
}

export function geminiClient(apiKey: string, model: string): LlmClient {
  const headers = { "content-type": "application/json", "x-goog-api-key": apiKey };

  async function call(
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<GenResult> {
    const resp = await fetchRetry(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    if (!resp.ok) {
      const t = (await resp.text()).slice(0, 300);
      if (resp.status === 503)
        throw new Error(
          "Le modèle Gemini est temporairement surchargé (503). Réessaie ou choisis un autre modèle.",
        );
      throw new Error(`Gemini ${resp.status}: ${t}`);
    }
    const body: any = await resp.json();
    const cand = body?.candidates?.[0];
    const text: string =
      cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    return { text, usage: usageOf(body?.usageMetadata), finishReason: cand?.finishReason };
  }

  return {
    provider: "gemini",
    model,
    async generate(system, userText, opts = {}) {
      const base: Record<string, unknown> = {
        temperature: opts.temperature ?? 0.6,
        maxOutputTokens: opts.maxOutputTokens ?? 4096,
      };
      const mk = (think: boolean) => ({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig:
          think && opts.thinkingBudget != null
            ? { ...base, thinkingConfig: { thinkingBudget: opts.thinkingBudget } }
            : base,
      });
      let r: GenResult;
      try {
        r = await call(mk(true), opts.signal);
      } catch (e) {
        // Certains modèles refusent thinkingConfig (ex. budget 0 sur 2.5-pro).
        if (opts.thinkingBudget != null && /thinking/i.test((e as Error).message)) {
          r = await call(mk(false), opts.signal);
        } else throw e;
      }
      if (!r.text)
        throw new Error(`Réponse Gemini vide (finishReason=${r.finishReason ?? "?"})`);
      return r;
    },
    async generateJSON(system, userText, schema, opts = {}) {
      const mk = (maxTok: number, think: boolean) => {
        const gc: Record<string, unknown> = {
          temperature: opts.temperature ?? 0.4,
          maxOutputTokens: maxTok,
          responseMimeType: "application/json",
        };
        if (schema) gc.responseSchema = schema;
        if (think && opts.thinkingBudget != null)
          gc.thinkingConfig = { thinkingBudget: opts.thinkingBudget };
        return {
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: gc,
        };
      };
      const callOnce = async (maxTok: number): Promise<GenResult> => {
        try {
          return await call(mk(maxTok, true), opts.signal);
        } catch (e) {
          // Certains modèles refusent thinkingConfig : on réessaie sans.
          if (opts.thinkingBudget != null && /thinking/i.test((e as Error).message)) {
            return await call(mk(maxTok, false), opts.signal);
          }
          throw e;
        }
      };
      let maxTok = opts.maxOutputTokens ?? 8192;
      let r = await callOnce(maxTok);
      // Sortie tronquée : on double le budget une fois (souvent la réflexion 2.5
      // a consommé une grande part du budget) avant d'abandonner.
      if (r.finishReason === "MAX_TOKENS" && maxTok < 65536) {
        maxTok = Math.min(maxTok * 2, 65536);
        r = await callOnce(maxTok);
      }
      if (r.finishReason === "MAX_TOKENS")
        throw new MaxTokensError(`JSON tronqué (${r.text.length} car.)`);
      if (!r.text)
        throw new Error(`Réponse JSON Gemini vide (finishReason=${r.finishReason ?? "?"})`);
      return { data: extractJson(r.text), usage: r.usage };
    },
    async stream(system, turns, opts = {}) {
      const resp = await fetch(`${BASE}/${model}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: turns.map((t) => ({
            role: t.role === "assistant" ? "model" : "user",
            parts: [{ text: t.text }],
          })),
          generationConfig: {
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: opts.maxOutputTokens ?? 3072,
          },
        }),
        signal: opts.signal,
      });
      if (!resp.ok || !resp.body) {
        const t = (await resp.text().catch(() => "")).slice(0, 200);
        throw new Error(
          resp.status === 503
            ? "Modèle Gemini surchargé (503). Réessaie ou change de modèle."
            : `Gemini ${resp.status}: ${t}`,
        );
      }
      return (async function* (): AsyncGenerator<StreamChunk> {
        for await (const p of sseLines(resp.body!)) {
          try {
            const obj = JSON.parse(p);
            const txt: string =
              obj?.candidates?.[0]?.content?.parts
                ?.map((x: any) => x?.text ?? "")
                .join("") ?? "";
            if (txt) yield { text: txt };
            if (obj?.usageMetadata) yield { usage: usageOf(obj.usageMetadata) };
          } catch {
            /* fragment SSE partiel */
          }
        }
      })();
    },
  };
}
