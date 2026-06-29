/**
 * Embeddings Gemini (text-embedding-004, 768 dimensions) pour le RAG pgvector.
 * Côté serveur uniquement.
 */
const EMBED_MODEL = "text-embedding-004";

export async function embed(apiKey: string, text: string): Promise<number[]> {
  if (!apiKey) throw new Error("Clé API Gemini manquante");

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
      }),
    },
  );
  if (!resp.ok)
    throw new Error(`Embedding ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const body: any = await resp.json();
  const values: number[] | undefined = body?.embedding?.values;
  if (!values?.length) throw new Error("Embedding vide");
  return values;
}
