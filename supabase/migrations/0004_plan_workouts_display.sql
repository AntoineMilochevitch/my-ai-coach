-- my-ai-coach — colonnes d'affichage des séances de plan.
alter table public.plan_workouts
  add column if not exists week_number integer,
  add column if not exists session_type text;
