-- =====================================================================
-- my-ai-coach — 0013 : journal post-activité.
-- Après une activité, l'athlète note son ressenti et son ravitaillement
-- (a-t-il mangé/bu pendant/autour, quoi, valeurs nutritionnelles). Alimente le
-- coach IA. SAISIE par l'utilisateur : CRUD complet self. 1 log par activité.
-- =====================================================================
create table if not exists public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  ressenti    text,
  fueled      boolean,      -- a mangé/bu pendant ou autour de la séance
  intake      text,         -- quoi (description libre)
  carbs_g     numeric,      -- glucides consommés
  fluids_ml   numeric,      -- liquides consommés
  calories    numeric,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, activity_id)
);
alter table public.activity_logs enable row level security;
create policy "activity_logs_all_own" on public.activity_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists activity_logs_user_idx
  on public.activity_logs (user_id, activity_id);

create trigger activity_logs_set_updated_at
  before update on public.activity_logs
  for each row execute function public.set_updated_at();
