/**
 * Function : set-ai-config — enregistre la config IA de l'utilisateur.
 * POST { provider?, model?, apiKey? }  + Authorization: Bearer <jwt>
 *  -> { ok, provider, model, keys }
 *
 * La clé est CHIFFRÉE dans ai_secrets (colonne selon le provider, jamais
 * renvoyée). provider/model + drapeaux non-secrets `keys` vont dans
 * profiles.settings (lisibles côté client via RLS).
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { encrypt } from "./_shared/crypto.ts";
import { colForProvider } from "./_shared/ai-config.ts";
import type { Provider } from "./_shared/llm/index.ts";

const PROVIDERS: Provider[] = ["gemini", "anthropic", "openai"];

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const { provider, model, apiKey } = await req.json().catch(() => ({}));

    const { data: prof } = await sb
      .from("profiles")
      .select("settings")
      .eq("id", user.id)
      .maybeSingle();
    const settings: Record<string, any> = { ...(prof?.settings ?? {}) };
    settings.keys = { ...(settings.keys ?? {}) };

    const prov: Provider | null = PROVIDERS.includes(provider) ? provider : null;
    if (prov) settings.ai_provider = prov;
    if (typeof model === "string" && model) settings.ai_model = model;

    if (typeof apiKey === "string" && apiKey.trim()) {
      if (!prov) throw new HttpError(400, "Provider requis pour enregistrer une clé.");
      const { error } = await sb.from("ai_secrets").upsert(
        {
          user_id: user.id,
          [colForProvider(prov)]: encrypt(apiKey.trim()),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
      settings.keys[prov] = true;
      if (prov === "gemini") settings.gemini_key_set = true; // compat
    }

    const { error: upErr } = await sb
      .from("profiles")
      .update({ settings })
      .eq("id", user.id);
    if (upErr) throw new Error(upErr.message);

    return json({
      ok: true,
      provider: settings.ai_provider ?? "gemini",
      model: settings.ai_model ?? null,
      keys: settings.keys,
    });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
