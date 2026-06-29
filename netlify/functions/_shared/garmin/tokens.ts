/**
 * Persistance des tokens Garmin (chiffrés) et du statut de connexion dans Supabase.
 * Côté serveur uniquement (service_role).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "../crypto.ts";
import type { GarminTokens } from "./auth.ts";

export async function storeTokens(
  sb: SupabaseClient,
  userId: string,
  tokens: GarminTokens,
): Promise<void> {
  const { error } = await sb.from("garmin_tokens").upsert(
    {
      user_id: userId,
      access_token_enc: encrypt(tokens.accessToken),
      refresh_token_enc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      client_id: tokens.clientId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`store tokens: ${error.message}`);
}

export async function loadTokens(
  sb: SupabaseClient,
  userId: string,
): Promise<GarminTokens | null> {
  const { data, error } = await sb
    .from("garmin_tokens")
    .select("access_token_enc, refresh_token_enc, client_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.access_token_enc) return null;
  return {
    accessToken: decrypt(data.access_token_enc),
    refreshToken: data.refresh_token_enc ? decrypt(data.refresh_token_enc) : null,
    clientId: data.client_id,
  };
}

export async function setConnected(
  sb: SupabaseClient,
  userId: string,
): Promise<void> {
  await sb.from("garmin_accounts").upsert(
    {
      user_id: userId,
      status: "connected",
      connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "user_id" },
  );
}
