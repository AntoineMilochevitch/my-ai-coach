import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Message explicite plutôt qu'un échec silencieux au runtime.
  console.error(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants — copie .env.example vers .env.",
  );
}

/**
 * Client Supabase côté navigateur : clé ANON uniquement (jamais service_role).
 * Toutes les lectures sont protégées par la RLS (user_id = auth.uid()).
 */
export const supabase = createClient(url ?? "", anonKey ?? "", {
  auth: { persistSession: true, autoRefreshToken: true },
});
