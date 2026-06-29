-- my-ai-coach — clés API IA par utilisateur (chiffrées). SECRET : RLS sans policy
-- (service_role uniquement). Le modèle/provider non-secrets vont dans profiles.settings.
create table if not exists public.ai_secrets (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  gemini_key_enc text,
  updated_at     timestamptz not null default now()
);
alter table public.ai_secrets enable row level security;
-- volontairement aucune policy.
