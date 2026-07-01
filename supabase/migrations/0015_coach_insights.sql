-- =====================================================================
-- my-ai-coach — 0015 : message proactif du coach (Dashboard).
-- Le coach génère un court bilan (dernière séance + alerte éventuelle + conseil).
-- 1 par utilisateur (upsert) ; régénéré avec parcimonie (voir client). Écrit par
-- les Functions (service_role) ; lecture self.
-- =====================================================================
create table if not exists public.coach_insights (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  content_md text not null,
  created_at timestamptz not null default now()
);
alter table public.coach_insights enable row level security;
create policy "coach_insights_select_own" on public.coach_insights
  for select using (user_id = auth.uid());
-- écritures réservées au service_role (Functions).
