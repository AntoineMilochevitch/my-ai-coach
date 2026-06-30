-- =====================================================================
-- my-ai-coach — 0009 : plan d'entraînement ADAPTATIF GLISSANT
--  * macro : squelette de périodisation sur tout l'horizon (phases, volumes
--    cibles, séances clés) — généré une fois, sert de fil conducteur.
--  * Le DÉTAIL des séances (plan_workouts) n'est matérialisé que pour les
--    semaines proches, puis ré-adapté au fil de la progression.
--  * last_adapted_at : horodatage de la dernière (ré)adaptation (poll côté UI).
--  * detail_weeks : nombre de semaines détaillées d'avance (fenêtre glissante).
-- =====================================================================
alter table public.training_plans
  add column if not exists macro           jsonb,
  add column if not exists last_adapted_at timestamptz,
  add column if not exists detail_weeks    integer not null default 2;
