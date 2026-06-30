/** Client OpenAI (Chat Completions). Implémente LlmClient. */
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
} from "./types.ts";

const URL = "https://api.openai.com/v1/chat/completions";

function usageOf(u: any): TokenUsage {
  return { in: Number(u?.prompt_tokens ?? 0), out: Number(u?.completion_tokens ?? 0) };
}

export function openaiClient(apiKey: string, model: string): LlmClient {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  // Les modèles de raisonnement (o*, gpt-5*) imposent max_completion_tokens et
  // température par défaut. Les autres acceptent max_tokens + temperature.
  const reasoning = /^(o\d|gpt-5)/i.test(model);

  function buildBody(
    system: string,
    turns: ChatTurn[],
    opts: GenerateOpts,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system },
        ...turns.map((t) => ({ role: t.role, content: t.text })),
      ],
      ...extra,
    };
    const maxTok = opts.maxOutputTokens;
    if (reasoning) {
      if (maxTok) body.max_completion_tokens = maxTok;
    } else {
      if (maxTok) body.max_tokens = maxTok;
      if (opts.temperature != null) body.temperature = opts.temperature;
    }
    return body;
  }

  async function call(
    system: string,
    turns: ChatTurn[],
    opts: GenerateOpts,
    extra: Record<string, unknown> = {},
  ): Promise<GenResult> {
    const resp = await fetchRetry(URL, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(system, turns, opts, extra)),
      signal: opts.signal,
    });
    if (!resp.ok) {
      const t = (await resp.text()).slice(0, 300);
      throw new Error(`OpenAI ${resp.status}: ${t}`);
    }
    const body: any = await resp.json();
    const choice = body?.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      usage: usageOf(body?.usage),
      finishReason: choice?.finish_reason,
    };
  }

  return {
    provider: "openai",
    model,
    async generate(system, userText, opts = {}) {
      const r = await call(system, [{ role: "user", text: userText }], {
        temperature: 0.6,
        ...opts,
      });
      if (!r.text)
        throw new Error(`Réponse OpenAI vide (finish_reason=${r.finishReason ?? "?"})`);
      return r;
    },
    async generateJSON(system, userText, _schema, opts = {}) {
      const run = (maxTok: number) =>
        call(
          system,
          [{ role: "user", text: userText }],
          { ...opts, temperature: opts.temperature ?? 0.4, maxOutputTokens: maxTok },
          { response_format: { type: "json_object" } },
        );
      let maxTok = opts.maxOutputTokens ?? 8192;
      let r = await run(maxTok);
      if (r.finishReason === "length" && maxTok < 32000) {
        maxTok = Math.min(maxTok * 2, 32000);
        r = await run(maxTok);
      }
      if (r.finishReason === "length")
        throw new MaxTokensError(`JSON tronqué (${r.text.length} car.)`);
      if (!r.text) throw new Error("Réponse JSON OpenAI vide");
      return { data: extractJson(r.text), usage: r.usage };
    },
    async stream(system, turns, opts = {}) {
      const resp = await fetch(URL, {
        method: "POST",
        headers,
        body: JSON.stringify(
          buildBody(
            system,
            turns,
            { temperature: 0.7, maxOutputTokens: 3072, ...opts },
            { stream: true, stream_options: { include_usage: true } },
          ),
        ),
        signal: opts.signal,
      });
      if (!resp.ok || !resp.body) {
        const t = (await resp.text().catch(() => "")).slice(0, 200);
        throw new Error(`OpenAI ${resp.status}: ${t}`);
      }
      return (async function* (): AsyncGenerator<StreamChunk> {
        let usage: TokenUsage = { in: 0, out: 0 };
        for await (const p of sseLines(resp.body!)) {
          try {
            const o = JSON.parse(p);
            const d = o.choices?.[0]?.delta?.content;
            if (d) yield { text: d };
            if (o.usage) usage = usageOf(o.usage);
          } catch {
            /* fragment SSE partiel */
          }
        }
        yield { usage };
      })();
    },
  };
}
