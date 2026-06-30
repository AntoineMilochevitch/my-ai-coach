-- my-ai-coach — étapes détaillées d'une séance (échauffement, fractionné, allures…)
-- pour construire un vrai workout structuré côté Garmin.
alter table public.plan_workouts
  add column if not exists steps jsonb;
