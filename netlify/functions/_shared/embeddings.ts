/**
 * Embeddings pour le RAG pgvector (768 dimensions, fixées par le schéma).
 * Multi-provider : Gemini (text-embedding-004) ou OpenAI (text-embedding-3-small
 * réduit à 768 dims). Le modèle utilisé est stocké par chunk pour ne jamais
 * comparer des vecteurs issus de modèles différents.
 * Côté serveur uniquement.
 */
export const EMBED_DIM = 768;

export interface EmbedConfig {
  provider: "gemini" | "openai";
  apiKey: string;
  model: string;
}

async function embedGemini(
  apiKey: string,
  model: string,
  text: string,
  timeoutMs: number,
): Promise<number[]> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] } }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!resp.ok)
    throw new Error(`Embedding Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const body: any = await resp.json();
  const values: number[] | undefined = body?.embedding?.values;
  if (!values?.length) throw new Error("Embedding Gemini vide");
  return values;
}

async function embedOpenAI(
  apiKey: string,
  model: string,
  text: string,
  timeoutMs: number,
): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: text, dimensions: EMBED_DIM }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok)
    throw new Error(`Embedding OpenAI ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const body: any = await resp.json();
  const values: number[] | undefined = body?.data?.[0]?.embedding;
  if (!values?.length) throw new Error("Embedding OpenAI vide");
  return values;
}

export async function embed(
  cfg: EmbedConfig,
  text: string,
  timeoutMs = 8000,
): Promise<number[]> {
  if (!cfg.apiKey) throw new Error("Clé d'embeddings manquante");
  const v =
    cfg.provider === "openai"
      ? await embedOpenAI(cfg.apiKey, cfg.model, text, timeoutMs)
      : await embedGemini(cfg.apiKey, cfg.model, text, timeoutMs);
  if (v.length !== EMBED_DIM)
    throw new Error(`Dimension d'embedding inattendue (${v.length} ≠ ${EMBED_DIM})`);
  return v;
}
