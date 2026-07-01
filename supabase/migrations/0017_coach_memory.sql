-- =====================================================================
-- my-ai-coach — 0017 : mémoire du coach (profil athlète persistant).
-- Faits durables réutilisés entre conversations : objectifs, blessures/santé,
-- préférences, contraintes. Un fait = une ligne. L'utilisateur gère sa mémoire
-- (RLS all-own) ; les Functions (service_role) la lisent pour le contexte IA ;
-- l'action chat "remember" y insère des faits (confirmés).
-- =====================================================================
create table if not exists public.coach_memory (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null default 'autre', -- objectif|blessure|preference|contrainte|autre
  content    text not null,
  created_at timestamptz not null default now()
);
alter table public.coach_memory enable row level security;
drop policy if exists "coach_memory_all_own" on public.coach_memory;
create policy "coach_memory_all_own" on public.coach_memory
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists coach_memory_user_idx
  on public.coach_memory (user_id, created_at desc);
