/**
 * Client Gemini (API REST). Côté serveur uniquement.
 * La clé et le modèle sont fournis PAR APPEL (config par utilisateur).
 * Gère le retry sur surcharge temporaire (503 / 429 / 500).
 */
export type GeminiPart = { text: string };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 503]);

async function callGemini(
  apiKey: string,
  model: string,
  payload: Record<string, unknown>,
  retries = 2,
): Promise<string> {
  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
      },
    );

    if (resp.ok) {
      const body: any = await resp.json();
      const cand = body?.candidates?.[0];
      const text: string =
        cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
      if (!text)
        throw new Error(`Réponse Gemini vide (finishReason=${cand?.finishReason ?? "?"})`);
      return text;
    }

    const status = resp.status;
    lastErr = (await resp.text()).slice(0, 300);

    if (RETRYABLE.has(status) && attempt < retries) {
      await sleep(700 * (attempt + 1)); // 700ms, 1400ms
      continue;
    }
    if (status === 503)
      throw new Error(
        "Le modèle Gemini est temporairement surchargé (503). Réessaie dans un instant, " +
          "ou choisis un autre modèle dans ton profil.",
      );
    throw new Error(`Gemini ${status}: ${lastErr}`);
  }
  throw new Error(`Gemini indisponible après ${retries + 1} tentatives: ${lastErr}`);
}

/** Génération mono-tour (system + un message utilisateur). */
export async function geminiGenerate(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  opts: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  return callGemini(apiKey, model, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.6,
      // gemini-2.5-* compte les tokens de "réflexion" ici : budget confortable.
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
    },
  });
}

/** Génération en SORTIE JSON contrainte (responseSchema). Renvoie l'objet parsé. */
export async function geminiGenerateJSON<T = any>(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  schema: Record<string, unknown>,
  opts: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<T> {
  const raw = await callGemini(apiKey, model, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      // Large budget : sur les modèles 2.5, les tokens de "réflexion" comptent ici,
      // donc on laisse de la marge pour que le JSON se termine sans être tronqué.
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  // Robustesse : retire d'éventuelles barrières markdown, puis tente d'extraire
  // l'objet JSON englobant si le parse direct échoue.
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(text.slice(s, e + 1)) as T;
      } catch {
        /* tombe dans l'erreur ci-dessous */
      }
    }
    throw new Error(
      `Réponse JSON du plan invalide (${text.length} car.) : ${text.slice(0, 150)}`,
    );
  }
}

/** Conversation multi-tours (system + historique). */
export async function geminiChat(
  apiKey: string,
  model: string,
  systemPrompt: string,
  contents: GeminiContent[],
  opts: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  return callGemini(apiKey, model, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxOutputTokens ?? 3072,
    },
  });
}
