-- =====================================================================
-- my-ai-coach — schéma initial (Phase 0)
-- Postgres + pgvector + RLS stricte. Conçu multi-utilisateurs dès le départ.
--
-- Principes RLS :
--   * Données "lisibles par l'utilisateur" : policy SELECT where user_id = auth.uid().
--     Les écritures (sync Garmin, IA) sont faites par les Netlify Functions avec
--     la clé service_role qui BYPASSE la RLS — donc PAS de policy insert/update
--     pour le rôle `authenticated` sur ces tables.
--   * Données saisies par l'utilisateur (nutrition, conversations) : CRUD complet self.
--   * Secrets (tokens Garmin, sessions MFA) : RLS activée SANS aucune policy →
--     `authenticated`/`anon` ne peuvent rien lire/écrire ; seul service_role accède.
-- =====================================================================

create extension if not exists vector;

-- ---------------------------------------------------------------------
-- Helper : trigger updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles : 1 ligne par utilisateur (créée automatiquement à l'inscription)
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  garmin_user_id text,
  unit_system   text not null default 'metric',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Crée le profil à la création du compte auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- garmin_accounts : statut de connexion Garmin VISIBLE par l'utilisateur
-- (jamais les tokens — voir garmin_tokens)
-- ---------------------------------------------------------------------
create table public.garmin_accounts (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  garmin_user_id text,
  status         text not null default 'disconnected', -- disconnected | connected | error | mfa_pending
  last_sync_at   timestamptz,
  last_error     text,
  connected_at   timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.garmin_accounts enable row level security;

create policy "garmin_accounts_select_own" on public.garmin_accounts
  for select using (user_id = auth.uid());
-- écritures réservées au service_role (Functions) → pas de policy authenticated.

create trigger garmin_accounts_set_updated_at
  before update on public.garmin_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- garmin_tokens : SECRET. RLS activée, AUCUNE policy → service_role only.
-- (tokens chiffrés au repos avec TOKEN_ENCRYPTION_KEY côté Function)
-- ---------------------------------------------------------------------
create table public.garmin_tokens (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  access_token_enc text,
  refresh_token_enc text,
  client_id        text,
  updated_at       timestamptz not null default now()
);
alter table public.garmin_tokens enable row level security;
-- volontairement aucune policy.

-- ---------------------------------------------------------------------
-- garmin_login_sessions : état MFA intermédiaire (cookie + méthode), TTL court.
-- SECRET. RLS activée, AUCUNE policy → service_role only.
-- ---------------------------------------------------------------------
create table public.garmin_login_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  payload_enc   text not null,  -- {cookie, mfaMethod} chiffré
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
alter table public.garmin_login_sessions enable row level security;
-- volontairement aucune policy.

-- ---------------------------------------------------------------------
-- activities
-- ---------------------------------------------------------------------
create table public.activities (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  garmin_activity_id bigint not null,
  activity_type      text,
  start_time         timestamptz,
  distance_m         numeric,
  duration_s         numeric,
  avg_hr             integer,
  max_hr             integer,
  avg_pace_s_per_km  numeric,
  elevation_gain_m   numeric,
  calories           integer,
  aerobic_te         numeric,
  anaerobic_te       numeric,
  training_load      numeric,
  vo2max             numeric,
  raw                jsonb,
  created_at         timestamptz not null default now(),
  unique (user_id, garmin_activity_id)
);
alter table public.activities enable row level security;
create policy "activities_select_own" on public.activities
  for select using (user_id = auth.uid());
create index activities_user_start_idx
  on public.activities (user_id, start_time desc);

-- ---------------------------------------------------------------------
-- daily_metrics : 1 ligne/jour
-- ---------------------------------------------------------------------
create table public.daily_metrics (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  metric_date        date not null,
  resting_hr         integer,
  hrv_avg            numeric,
  stress_avg         integer,
  body_battery_min   integer,
  body_battery_max   integer,
  vo2max             numeric,
  training_readiness integer,
  training_status    text,
  endurance_score    integer,
  raw                jsonb,
  created_at         timestamptz not null default now(),
  unique (user_id, metric_date)
);
alter table public.daily_metrics enable row level security;
create policy "daily_metrics_select_own" on public.daily_metrics
  for select using (user_id = auth.uid());
create index daily_metrics_user_date_idx
  on public.daily_metrics (user_id, metric_date desc);

-- ---------------------------------------------------------------------
-- sleep
-- ---------------------------------------------------------------------
create table public.sleep (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  sleep_date  date not null,
  total_s     integer,
  deep_s      integer,
  rem_s       integer,
  light_s     integer,
  awake_s     integer,
  score       integer,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, sleep_date)
);
alter table public.sleep enable row level security;
create policy "sleep_select_own" on public.sleep
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- nutrition_entries : SAISIE par l'utilisateur → CRUD complet self
-- ---------------------------------------------------------------------
create table public.nutrition_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entry_date  date not null,
  meal        text,
  label       text,
  calories    numeric,
  protein_g   numeric,
  carbs_g     numeric,
  fat_g       numeric,
  created_at  timestamptz not null default now()
);
alter table public.nutrition_entries enable row level security;
create policy "nutrition_all_own" on public.nutrition_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index nutrition_user_date_idx
  on public.nutrition_entries (user_id, entry_date desc);

-- ---------------------------------------------------------------------
-- ai_analyses : généré par les Functions (service_role) ; lecture self
-- ---------------------------------------------------------------------
create table public.ai_analyses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  scope        text not null check (scope in ('activity', 'period')),
  ref_id       text,
  period_start date,
  period_end   date,
  model        text,
  content_md   text,
  context      jsonb,
  created_at   timestamptz not null default now()
);
alter table public.ai_analyses enable row level security;
create policy "ai_analyses_select_own" on public.ai_analyses
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- conversations + chat_messages
-- ---------------------------------------------------------------------
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now()
);
alter table public.conversations enable row level security;
create policy "conversations_all_own" on public.conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null,
  created_at      timestamptz not null default now()
);
alter table public.chat_messages enable row level security;
-- L'utilisateur lit ses messages et insère les siens ; les réponses "assistant"
-- sont insérées par la Function (service_role, bypass RLS).
create policy "chat_messages_select_own" on public.chat_messages
  for select using (user_id = auth.uid());
create policy "chat_messages_insert_own" on public.chat_messages
  for insert with check (user_id = auth.uid());
create index chat_messages_conv_idx
  on public.chat_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- training_plans + plan_workouts
-- ---------------------------------------------------------------------
create table public.training_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  goal         text,
  level        text,
  availability jsonb,
  start_date   date,
  end_date     date,
  content      jsonb,
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);
alter table public.training_plans enable row level security;
create policy "training_plans_select_own" on public.training_plans
  for select using (user_id = auth.uid());

create table public.plan_workouts (
  id                   uuid primary key default gen_random_uuid(),
  plan_id              uuid not null references public.training_plans(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  scheduled_date       date,
  sport                text,
  title                text,
  description          text,
  target               jsonb,
  completed_activity_id uuid references public.activities(id) on delete set null,
  status               text not null default 'planned',  -- planned | done | skipped
  created_at           timestamptz not null default now()
);
alter table public.plan_workouts enable row level security;
create policy "plan_workouts_select_own" on public.plan_workouts
  for select using (user_id = auth.uid());
-- l'utilisateur peut marquer une séance faite/sautée
create policy "plan_workouts_update_own" on public.plan_workouts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create index plan_workouts_user_date_idx
  on public.plan_workouts (user_id, scheduled_date);

-- ---------------------------------------------------------------------
-- rag_chunks : embeddings pour le RAG (Phase 4). Écrits par les Functions.
-- ---------------------------------------------------------------------
create table public.rag_chunks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source_type text not null,           -- activity | daily_metric | sleep | nutrition | note
  source_id   text,
  content     text not null,
  embedding   vector(768),             -- Gemini text-embedding-004
  created_at  timestamptz not null default now()
);
alter table public.rag_chunks enable row level security;
create policy "rag_chunks_select_own" on public.rag_chunks
  for select using (user_id = auth.uid());
-- Index ANN cosinus (HNSW) pour la recherche de similarité.
create index rag_chunks_embedding_idx
  on public.rag_chunks using hnsw (embedding vector_cosine_ops);
create index rag_chunks_user_idx on public.rag_chunks (user_id);

-- Recherche de similarité scopée à un utilisateur.
-- SECURITY INVOKER (défaut) : pour `authenticated` la RLS limite déjà aux lignes
-- de l'appelant ; pour service_role (Functions) le p_user_id filtre explicitement.
create or replace function public.match_rag_chunks(
  p_user_id uuid,
  query_embedding vector(768),
  match_count int default 8
)
returns table (
  id uuid,
  content text,
  source_type text,
  source_id text,
  similarity float
)
language sql stable as $$
  select rc.id, rc.content, rc.source_type, rc.source_id,
         1 - (rc.embedding <=> query_embedding) as similarity
  from public.rag_chunks rc
  where rc.user_id = p_user_id
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;
