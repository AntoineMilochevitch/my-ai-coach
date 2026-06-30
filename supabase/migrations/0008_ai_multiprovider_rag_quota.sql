-- =====================================================================
-- my-ai-coach — 0008
--  * Clés API multi-provider (Gemini + Anthropic/Claude + OpenAI) chiffrées.
--  * RAG : modèle d'embedding par chunk (mélange de modèles interdit dans un
--    même espace vectoriel) + recherche filtrée par modèle. Index multi-source.
--  * Quotas IA par utilisateur (anti-abus / maîtrise du coût) — free tier.
--  * Notes libres de l'athlète (ressenti) indexées dans le RAG.
--  * Déduplication des analyses (1 par scope/période/jour).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Clés API par provider. SECRET : RLS sans policy (service_role only).
-- ---------------------------------------------------------------------
alter table public.ai_secrets
  add column if not exists anthropic_key_enc text,
  add column if not exists openai_key_enc   text;

-- ---------------------------------------------------------------------
-- 2) RAG : modèle d'embedding par chunk + dédup par (user, source).
-- ---------------------------------------------------------------------
alter table public.rag_chunks
  add column if not exists embed_model text not null default 'text-embedding-004';

-- Évite les doublons d'indexation (et permet l'upsert).
create unique index if not exists rag_chunks_user_source_idx
  on public.rag_chunks (user_id, source_type, source_id);

-- Recherche de similarité scopée à un utilisateur ET à un modèle d'embedding
-- (on ne compare jamais des vecteurs issus de modèles différents).
-- On retire l'ancienne signature à 3 arguments (migration 0001) pour éviter une
-- surcharge ambiguë.
drop function if exists public.match_rag_chunks(uuid, vector, int);

create or replace function public.match_rag_chunks(
  p_user_id uuid,
  query_embedding vector(768),
  match_count int default 8,
  p_embed_model text default 'text-embedding-004'
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
    and rc.embed_model = p_embed_model
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------
-- 3) Quotas IA : 1 compteur par (user, jour, type d'appel). Écrit par les
--    Functions (service_role). Lecture self autorisée (affichage éventuel).
-- ---------------------------------------------------------------------
create table if not exists public.ai_usage (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  day        date    not null default (now() at time zone 'utc')::date,
  kind       text    not null,                 -- chat | analyze | nutrition | plan | embed
  count      integer not null default 0,
  tokens_in  bigint  not null default 0,
  tokens_out bigint  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);
alter table public.ai_usage enable row level security;
create policy "ai_usage_select_own" on public.ai_usage
  for select using (user_id = auth.uid());

-- Incrément atomique (réservation + tokens), renvoie le nouveau compteur du jour.
create or replace function public.bump_ai_usage(
  p_user_id uuid,
  p_kind text,
  p_tokens_in bigint default 0,
  p_tokens_out bigint default 0
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into public.ai_usage (user_id, day, kind, count, tokens_in, tokens_out, updated_at)
  values (p_user_id, (now() at time zone 'utc')::date, p_kind, 1, p_tokens_in, p_tokens_out, now())
  on conflict (user_id, day, kind) do update
    set count      = public.ai_usage.count + 1,
        tokens_in  = public.ai_usage.tokens_in + excluded.tokens_in,
        tokens_out = public.ai_usage.tokens_out + excluded.tokens_out,
        updated_at = now()
  returning count into v_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Notes libres de l'athlète (ressenti, blessures, contexte) → RAG.
--    SAISIE par l'utilisateur : CRUD complet self.
-- ---------------------------------------------------------------------
create table if not exists public.training_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  note_date  date not null default (now() at time zone 'utc')::date,
  content    text not null,
  created_at timestamptz not null default now()
);
alter table public.training_notes enable row level security;
create policy "training_notes_all_own" on public.training_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists training_notes_user_date_idx
  on public.training_notes (user_id, note_date desc);

-- ---------------------------------------------------------------------
-- 5) Déduplication des analyses : au plus une par (user, scope, période).
--    On nettoie d'abord les doublons existants, puis on pose l'index unique.
-- ---------------------------------------------------------------------
delete from public.ai_analyses a using public.ai_analyses b
  where a.ctid < b.ctid
    and a.user_id = b.user_id
    and a.scope = b.scope
    and coalesce(a.period_start, '0001-01-01') = coalesce(b.period_start, '0001-01-01')
    and coalesce(a.period_end,   '0001-01-01') = coalesce(b.period_end,   '0001-01-01');

create unique index if not exists ai_analyses_dedup_idx
  on public.ai_analyses (
    user_id, scope,
    coalesce(period_start, '0001-01-01'),
    coalesce(period_end,   '0001-01-01')
  );
