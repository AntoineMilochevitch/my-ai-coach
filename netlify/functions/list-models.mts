/**
 * Function : list-models — récupère les modèles Gemini disponibles pour la clé
 * de l'utilisateur (endpoint ListModels). Si une clé est fournie dans le corps
 * et qu'elle fonctionne, on la sauvegarde (chiffrée) au passage.
 *
 * POST { geminiKey? }  + Authorization: Bearer <jwt>
 *  -> { models: [{id,label}], gemini_key_set }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { encrypt, decrypt } from "./_shared/crypto.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const provided =
      typeof body.geminiKey === "string" && body.geminiKey.trim().length > 0;
    let key = provided ? body.geminiKey.trim() : "";

    if (!key) {
      const { data: sec } = await sb
        .from("ai_secrets")
        .select("gemini_key_enc")
        .eq("user_id", user.id)
        .maybeSingle();
      if (sec?.gemini_key_enc) {
        try {
          key = decrypt(sec.gemini_key_enc);
        } catch {
          /* clé illisible */
        }
      }
      if (!key) key = process.env.GEMINI_API_KEY ?? "";
    }
    if (!key) return json({ error: "Renseigne ta clé API Gemini." }, 400);

    // Récupère et valide via ListModels.
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      { headers: { "x-goog-api-key": key } },
    );
    if (!resp.ok) {
      const t = (await resp.text()).slice(0, 200);
      return json(
        { error: `Clé refusée ou API indisponible (${resp.status}). ${t}` },
        400,
      );
    }
    // Exclut les modèles non-texte (image/"nano banana", TTS, audio, embeddings…).
    const EXCLUDE = /image|vision|tts|audio|embedding|aqa|live|nano-banana/i;
    const data: any = await resp.json();
    const models = (data.models ?? [])
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
      .filter((m: { id: string }) => m.id)
      .sort((a: { label: string }, b: { label: string }) =>
        b.label.localeCompare(a.label),
      );

    // La clé fournie fonctionne → on la persiste (chiffrée).
    if (provided) {
      await sb.from("ai_secrets").upsert(
        {
          user_id: user.id,
          gemini_key_enc: encrypt(key),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      const { data: prof } = await sb
        .from("profiles")
        .select("settings")
        .eq("id", user.id)
        .maybeSingle();
      const settings = { ...(prof?.settings ?? {}), gemini_key_set: true };
      await sb.from("profiles").update({ settings }).eq("id", user.id);
    }

    return json({ models, gemini_key_set: true });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
