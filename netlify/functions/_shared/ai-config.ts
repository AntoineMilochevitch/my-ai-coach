/**
 * Configuration IA par utilisateur :
 *  - provider (gemini | anthropic | openai) + modèle dans profiles.settings ;
 *  - clé API du provider chiffrée dans ai_secrets (une colonne par provider) ;
 *  - fuseau horaire de l'athlète dans settings (par défaut Europe/Paris) ;
 *  - config d'embeddings pour le RAG (Gemini prioritaire, sinon OpenAI).
 *
 * Repli sur la clé d'environnement du serveur UNIQUEMENT pour les comptes
 * propriétaires listés dans OWNER_EMAILS (sinon chacun paie sa propre clé).
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { decrypt } from "./crypto.ts";
import { HttpError } from "./supabase.ts";
import type { Provider } from "./llm/index.ts";
import type { EmbedConfig } from "./embeddings.ts";

export interface AiConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  embed: EmbedConfig | null;
  timezone: string;
}

const PROVIDERS: Provider[] = ["gemini", "anthropic", "openai"];
const DEFAULT_MODEL: Record<Provider, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
};

const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function colForProvider(p: Provider): string {
  return p === "anthropic"
    ? "anthropic_key_enc"
    : p === "openai"
      ? "openai_key_enc"
      : "gemini_key_enc";
}

export async function loadAiConfig(sb: SupabaseClient, user: User): Promise<AiConfig> {
  const { data: prof } = await sb
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .maybeSingle();
  const settings: any = prof?.settings ?? {};

  const provider: Provider = PROVIDERS.includes(settings.ai_provider)
    ? settings.ai_provider
    : "gemini";
  const model =
    settings.ai_model ||
    (provider === "gemini" ? process.env.GEMINI_MODEL : "") ||
    DEFAULT_MODEL[provider];
  const timezone =
    typeof settings.timezone === "string" && settings.timezone
      ? settings.timezone
      : "Europe/Paris";

  const { data: sec } = await sb
    .from("ai_secrets")
    .select("gemini_key_enc, anthropic_key_enc, openai_key_enc")
    .eq("user_id", user.id)
    .maybeSingle();
  const dec = (v?: string | null): string => {
    if (!v) return "";
    try {
      return decrypt(v);
    } catch {
      return ""; // clé illisible (TOKEN_ENCRYPTION_KEY changée ?)
    }
  };
  const keys = {
    gemini: dec(sec?.gemini_key_enc),
    anthropic: dec(sec?.anthropic_key_enc),
    openai: dec(sec?.openai_key_enc),
  };

  const isOwner = OWNER_EMAILS.includes((user.email ?? "").toLowerCase());
  const ownerGemini = isOwner ? process.env.GEMINI_API_KEY ?? "" : "";

  let apiKey = keys[provider];
  if (!apiKey && provider === "gemini") apiKey = ownerGemini;
  if (!apiKey)
    throw new HttpError(
      400,
      `Configure ta clé API ${provider} dans ton profil pour utiliser le coach IA.`,
    );

  // Embeddings (RAG) : indépendants du provider de chat. Gemini en priorité
  // (768 dims natifs), sinon OpenAI (réduit à 768).
  const geminiEmbedKey = keys.gemini || ownerGemini;
  let embed: EmbedConfig | null = null;
  if (geminiEmbedKey)
    embed = { provider: "gemini", apiKey: geminiEmbedKey, model: "text-embedding-004" };
  else if (keys.openai)
    embed = { provider: "openai", apiKey: keys.openai, model: "text-embedding-3-small" };

  return { provider, apiKey, model, embed, timezone };
}
