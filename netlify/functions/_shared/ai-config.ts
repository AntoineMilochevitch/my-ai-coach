/**
 * Configuration IA par utilisateur : clé API (chiffrée dans ai_secrets) +
 * modèle/provider (dans profiles.settings). Repli sur les variables d'env du
 * serveur si l'utilisateur n'a rien configuré (transition / compte propriétaire).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./crypto.ts";
import { HttpError } from "./supabase.ts";

export interface AiConfig {
  apiKey: string;
  model: string;
  provider: string;
}

export async function loadAiConfig(
  sb: SupabaseClient,
  userId: string,
): Promise<AiConfig> {
  const { data: prof } = await sb
    .from("profiles")
    .select("settings")
    .eq("id", userId)
    .maybeSingle();
  const settings: any = prof?.settings ?? {};

  const model = settings.ai_model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const provider = settings.ai_provider || "gemini";

  let apiKey = "";
  const { data: sec } = await sb
    .from("ai_secrets")
    .select("gemini_key_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (sec?.gemini_key_enc) {
    try {
      apiKey = decrypt(sec.gemini_key_enc);
    } catch {
      // clé illisible (clé de chiffrement changée ?) → on tombera sur l'erreur ci-dessous
    }
  }
  if (!apiKey) apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey)
    throw new HttpError(
      400,
      "Configure ta clé API Gemini dans ton profil pour utiliser le coach IA.",
    );

  return { apiKey, model, provider };
}
