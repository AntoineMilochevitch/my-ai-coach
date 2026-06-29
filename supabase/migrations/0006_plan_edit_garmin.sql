-- my-ai-coach — édition/suppression de plan + lien séance Garmin.

-- L'utilisateur peut supprimer son propre plan (cascade -> plan_workouts).
create policy "training_plans_delete_own" on public.training_plans
  for delete using (user_id = auth.uid());

-- Id de la séance créée côté Garmin (téléversement), pour éviter les doublons.
alter table public.plan_workouts
  add column if not exists garmin_workout_id bigint;
