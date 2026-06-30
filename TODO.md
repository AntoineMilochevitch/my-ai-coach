# TODO

## Fonctionnalités

- [ ] **Apport nutritionnel généré par l'IA** — faire estimer par le modèle les valeurs
  nutritionnelles (calories, protéines, glucides, lipides) d'un repas à partir de sa
  description, au lieu d'une saisie manuelle.

- [ ] **Tutoriel interactif** — parcours guidé à la première connexion : présentation du
  site, connexion à Garmin, mise en place de la clé API IA et choix du modèle, première
  synchronisation, génération d'un plan.

- [ ] **Onglet Planning** — vue calendrier dédiée des séances (semaine / mois), distincte
  de la liste du plan.

## Bugs

- [ ] **`Could not find the 'steps' column of 'plan_workouts' in the schema cache`** lors
  de la création d'un plan.
  - Cause probable : migrations non appliquées sur la base de prod (la colonne `steps`
    vient de `0007_plan_workout_steps.sql` ; voir aussi `0008` et `0009`).
  - À faire : appliquer les migrations `0007` → `0009` sur le projet Supabase, puis
    recharger le cache de schéma PostgREST (Supabase → API → « Reload schema », ou
    `NOTIFY pgrst, 'reload schema';`).
  - Vérifier l'application de toutes les migrations avant chaque déploiement.
