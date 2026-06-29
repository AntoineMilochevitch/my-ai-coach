/**
 * Function : set-ai-config — enregistre la config IA de l'utilisateur.
 * POST { geminiKey?, model?, provider? }  + Authorization: Bearer <jwt>
 *  -> { ok, model, provider, gemini_key_set }
 *
 * La clé est CHIFFRÉE dans ai_secrets (jamais renvoyée). Le modèle/provider et
 * un drapeau non-secret gemini_key_set vont dans profiles.settings (lisible
 * côté client via RLS).
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { encrypt } from "./_shared/crypto.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const { geminiKey, model, provider } = await req.json().catch(() => ({}));

    const { data: prof } = await sb
      .from("profiles")
      .select("settings")
      .eq("id", user.id)
      .maybeSingle();
    const settings: Record<string, unknown> = { ...(prof?.settings ?? {}) };

    if (typeof model === "string" && model) settings.ai_model = model;
    if (typeof provider === "string" && provider) settings.ai_provider = provider;

    if (typeof geminiKey === "string" && geminiKey.trim()) {
      const { error } = await sb.from("ai_secrets").upsert(
        {
          user_id: user.id,
          gemini_key_enc: encrypt(geminiKey.trim()),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
      settings.gemini_key_set = true;
    }

    const { error: upErr } = await sb
      .from("profiles")
      .update({ settings })
      .eq("id", user.id);
    if (upErr) throw new Error(upErr.message);

    return json({
      ok: true,
      model: (settings.ai_model as string) ?? null,
      provider: (settings.ai_provider as string) ?? "gemini",
      gemini_key_set: Boolean(settings.gemini_key_set),
    });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
