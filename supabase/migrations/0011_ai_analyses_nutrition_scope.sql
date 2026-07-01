-- =====================================================================
-- my-ai-coach — 0011 : autoriser le scope 'nutrition' dans ai_analyses.
-- Les conseils nutrition (générés en arrière-plan) y sont désormais persistés,
-- ce qui permet au client de les récupérer par polling (comme les analyses).
-- =====================================================================
alter table public.ai_analyses
  drop constraint if exists ai_analyses_scope_check;
alter table public.ai_analyses
  add constraint ai_analyses_scope_check
  check (scope in ('activity', 'period', 'nutrition'));
