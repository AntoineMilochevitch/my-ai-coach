/**
 * Client Gemini (API REST). Côté serveur uniquement — GEMINI_API_KEY ne doit
 * jamais être exposée au client.
 */
const DEFAULT_MODEL = "gemini-2.5-flash";

export async function geminiGenerate(
  systemPrompt: string,
  userText: string,
  opts: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY manquant (env Netlify)");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.6,
          maxOutputTokens: opts.maxOutputTokens ?? 2048,
        },
      }),
    },
  );

  if (!resp.ok)
    throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const body: any = await resp.json();
  const text = body?.candidates?.[0]?.content?.parts
    ?.map((p: any) => p?.text ?? "")
    .join("");
  if (!text) throw new Error("Réponse Gemini vide");
  return text;
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}
