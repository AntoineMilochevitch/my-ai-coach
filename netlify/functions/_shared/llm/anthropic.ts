/** Client Anthropic (Claude). API Messages. Implémente LlmClient. */
import {
  type LlmClient,
  type GenResult,
  type GenerateOpts,
  type ChatTurn,
  type StreamChunk,
  type TokenUsage,
  MaxTokensError,
  fetchRetry,
  sseLines,
  extractJson,
  timeoutController,
} from "./types.ts";

const URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT = 60000;

function usageOf(u: any): TokenUsage {
  return { in: Number(u?.input_tokens ?? 0), out: Number(u?.output_tokens ?? 0) };
}

export function anthropicClient(apiKey: string, model: string): LlmClient {
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  async function call(
    system: string,
    turns: ChatTurn[],
    opts: GenerateOpts,
  ): Promise<GenResult> {
    const tc = timeoutController(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT);
    try {
      const resp = await fetchRetry(URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: opts.maxOutputTokens ?? 4096,
          temperature: opts.temperature ?? 0.6,
          system,
          messages: turns.map((t) => ({ role: t.role, content: t.text })),
        }),
        signal: tc.signal,
      });
      if (!resp.ok) {
        const t = (await resp.text()).slice(0, 300);
        throw new Error(`Claude ${resp.status}: ${t}`);
      }
      const body: any = await resp.json();
      const text: string = (body?.content ?? [])
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b?.text ?? "")
        .join("");
      return { text, usage: usageOf(body?.usage), finishReason: body?.stop_reason };
    } finally {
      tc.clear();
    }
  }

  return {
    provider: "anthropic",
    model,
    async generate(system, userText, opts = {}) {
      const r = await call(system, [{ role: "user", text: userText }], opts);
      if (!r.text)
        throw new Error(`Réponse Claude vide (stop_reason=${r.finishReason ?? "?"})`);
      return r;
    },
    async generateJSON(system, userText, _schema, opts = {}) {
      // Claude n'a pas de responseSchema : on contraint via le prompt système.
      const sys = `${system}\n\nRéponds UNIQUEMENT avec un objet JSON valide, sans texte ni barrière markdown autour.`;
      const run = (maxTok: number) =>
        call(sys, [{ role: "user", text: userText }], {
          ...opts,
          maxOutputTokens: maxTok,
          temperature: opts.temperature ?? 0.4,
        });
      let maxTok = opts.maxOutputTokens ?? 8192;
      let r = await run(maxTok);
      if (r.finishReason === "max_tokens" && maxTok < 32000) {
        maxTok = Math.min(maxTok * 2, 32000);
        r = await run(maxTok);
      }
      if (r.finishReason === "max_tokens")
        throw new MaxTokensError(`JSON tronqué (${r.text.length} car.)`);
      if (!r.text) throw new Error("Réponse JSON Claude vide");
      return { data: extractJson(r.text), usage: r.usage };
    },
    async stream(system, turns, opts = {}) {
      const tc = timeoutController(opts.signal, opts.timeoutMs ?? 30000);
      let resp: Response;
      try {
        resp = await fetch(URL, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            max_tokens: opts.maxOutputTokens ?? 3072,
            temperature: opts.temperature ?? 0.7,
            system,
            messages: turns.map((t) => ({ role: t.role, content: t.text })),
            stream: true,
          }),
          signal: tc.signal,
        });
      } catch (e) {
        tc.clear();
        throw e;
      }
      tc.clear();
      if (!resp.ok || !resp.body) {
        const t = (await resp.text().catch(() => "")).slice(0, 200);
        throw new Error(`Claude ${resp.status}: ${t}`);
      }
      return (async function* (): AsyncGenerator<StreamChunk> {
        let inTok = 0;
        let outTok = 0;
        for await (const p of sseLines(resp.body!)) {
          try {
            const o = JSON.parse(p);
            if (o.type === "content_block_delta" && o.delta?.type === "text_delta")
              yield { text: o.delta.text };
            else if (o.type === "message_start")
              inTok = o.message?.usage?.input_tokens ?? inTok;
            else if (o.type === "message_delta")
              outTok = o.usage?.output_tokens ?? outTok;
          } catch {
            /* fragment SSE partiel */
          }
        }
        yield { usage: { in: inTok, out: outTok } };
      })();
    },
  };
}
