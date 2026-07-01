-- =====================================================================
-- my-ai-coach — 0012 : plan nutrition recommandé par l'IA.
-- Repas recommandés + macros cibles + explication, calibrés sur l'objectif et
-- la charge d'entraînement. 1 par utilisateur (upsert). Écrit par les Functions
-- (service_role) ; lecture self. Consultable/modifiable via le chat.
-- =====================================================================
create table if not exists public.nutrition_plans (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  content    jsonb not null,
  model      text,
  updated_at timestamptz not null default now()
);
alter table public.nutrition_plans enable row level security;
create policy "nutrition_plans_select_own" on public.nutrition_plans
  for select using (user_id = auth.uid());
-- écritures réservées au service_role (Functions) → pas de policy authenticated.
