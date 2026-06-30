/**
 * Function : list-models — valide une clé API et liste les modèles texte du
 * provider demandé (Gemini / Anthropic / OpenAI). Si une clé est fournie et
 * fonctionne, on la sauvegarde (chiffrée) au passage.
 *
 * POST { provider?, apiKey?, geminiKey? }  + Authorization: Bearer <jwt>
 *  -> { provider, models: [{id,label}], key_set }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { encrypt, decrypt } from "./_shared/crypto.ts";
import { colForProvider } from "./_shared/ai-config.ts";
import type { Provider } from "./_shared/llm/index.ts";

const PROVIDERS: Provider[] = ["gemini", "anthropic", "openai"];

type Model = { id: string; label: string };

async function geminiModels(key: string): Promise<Model[]> {
  const resp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    { headers: { "x-goog-api-key": key } },
  );
  if (!resp.ok)
    throw new HttpError(400, `Clé Gemini refusée (${resp.status}). ${(await resp.text()).slice(0, 200)}`);
  const EXCLUDE = /image|vision|tts|audio|embedding|aqa|live|nano-banana/i;
  const data: any = await resp.json();
  return (data.models ?? [])
    .filter(
      (m: any) =>
        (m.supportedGenerationMethods ?? []).includes("generateContent") &&
        !EXCLUDE.test(String(m.name ?? "")) &&
        !EXCLUDE.test(String(m.displayName ?? "")),
    )
    .map((m: any) => ({
      id: String(m.name ?? "").replace(/^models\//, ""),
      label: m.displayName || String(m.name ?? "").replace(/^models\//, ""),
    }))
    .filter((m: Model) => m.id);
}

async function anthropicModels(key: string): Promise<Model[]> {
  const resp = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  });
  if (!resp.ok)
    throw new HttpError(400, `Clé Claude refusée (${resp.status}). ${(await resp.text()).slice(0, 200)}`);
  const data: any = await resp.json();
  return (data.data ?? [])
    .map((m: any) => ({ id: String(m.id ?? ""), label: m.display_name || String(m.id ?? "") }))
    .filter((m: Model) => m.id);
}

async function openaiModels(key: string): Promise<Model[]> {
  const resp = await fetch("https://api.openai.com/v1/models", {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!resp.ok)
    throw new HttpError(400, `Clé OpenAI refusée (${resp.status}). ${(await resp.text()).slice(0, 200)}`);
  const data: any = await resp.json();
  // Garde les modèles de chat/raisonnement, exclut embeddings/audio/image/etc.
  const KEEP = /^(gpt-|o\d|chatgpt)/i;
  const EXCLUDE = /embedding|whisper|tts|audio|realtime|image|dall-e|moderation|transcribe|search/i;
  return (data.data ?? [])
    .map((m: any) => String(m.id ?? ""))
    .filter((id: string) => id && KEEP.test(id) && !EXCLUDE.test(id))
    .sort()
    .map((id: string) => ({ id, label: id }));
}

async function listFor(provider: Provider, key: string): Promise<Model[]> {
  const models =
    provider === "anthropic"
      ? await anthropicModels(key)
      : provider === "openai"
        ? await openaiModels(key)
        : await geminiModels(key);
  return models.sort((a, b) => b.label.localeCompare(a.label));
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const provider: Provider = PROVIDERS.includes(body.provider) ? body.provider : "gemini";
    const rawKey = typeof body.apiKey === "string" ? body.apiKey : body.geminiKey;
    const provided = typeof rawKey === "string" && rawKey.trim().length > 0;
    let key = provided ? rawKey.trim() : "";

    if (!key) {
      const col = colForProvider(provider);
      const { data: sec } = await sb
        .from("ai_secrets")
        .select(col)
        .eq("user_id", user.id)
        .maybeSingle();
      const enc = (sec as any)?.[col];
      if (enc) {
        try {
          key = decrypt(enc);
        } catch {
          /* clé illisible */
        }
      }
      if (!key && provider === "gemini") key = process.env.GEMINI_API_KEY ?? "";
    }
    if (!key) return json({ error: `Renseigne ta clé API ${provider}.` }, 400);

    const models = await listFor(provider, key);

    // La clé fournie fonctionne → on la persiste (chiffrée) + drapeau non-secret.
    if (provided) {
      await sb.from("ai_secrets").upsert(
        {
          user_id: user.id,
          [colForProvider(provider)]: encrypt(key),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      const { data: prof } = await sb
        .from("profiles")
        .select("settings")
        .eq("id", user.id)
        .maybeSingle();
      const settings: Record<string, any> = { ...(prof?.settings ?? {}) };
      settings.keys = { ...(settings.keys ?? {}), [provider]: true };
      if (provider === "gemini") settings.gemini_key_set = true; // compat
      await sb.from("profiles").update({ settings }).eq("id", user.id);
    }

    return json({ provider, models, key_set: true });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
