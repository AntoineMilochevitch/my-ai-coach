/**
 * Client Supabase côté serveur (service_role) + vérification du JWT utilisateur.
 * À n'utiliser QUE dans les Netlify Functions — la clé service_role bypasse la RLS.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants (env Netlify)");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Vérifie le JWT Supabase de l'en-tête Authorization et renvoie l'utilisateur.
 * On ne fait JAMAIS confiance à un user_id envoyé par le client : c'est le token
 * vérifié qui fait foi.
 */
export async function requireUser(
  req: Request,
): Promise<{ user: User; sb: SupabaseClient }> {
  const header = req.headers.get("authorization") ?? "";
  const jwt = header.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw new HttpError(401, "Token d'authentification manquant");

  const sb = serviceClient();
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Token invalide");
  return { user: data.user, sb };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
