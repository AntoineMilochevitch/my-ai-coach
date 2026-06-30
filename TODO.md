# TODO

## Fonctionnalités

- [ ] **Apport nutritionnel généré par l'IA** — faire estimer par le modèle les valeurs nutritionnelles (calories, protéines, glucides, lipides) d'un repas à partir de sa description, au lieu d'une saisie manuelle.

- [ ] **Tutoriel interactif** — parcours guidé à la première connexion : présentation du site, connexion à Garmin, mise en place de la clé API IA et choix du modèle, première synchronisation, génération d'un plan.

- [ ] **Onglet Planning** — vue calendrier dédiée des séances (semaine / mois), distincte de la liste du plan.

- [ ] **Création d'activité depuis le chat** - le coach peut créer des activités depuis le chat, qu'on peut directement envoyé à la montre

- [ ] **logo** - Faire un prompt pour générer un logo pour le site et le mettre dans le site et en favicon

- [ ] **Nutrition pendant l'effort** - inclure un plan de nutrition pendant l'effort (optionnel que l'utilisateur peut demander ou non), et après chaque activité, la possibilité, en plus d'ajouté sont ressenti, dire si on a mangé et bu, quoi, et les valeur nutritionnelle.

- [ ] **Améliorer la nutrition** - Le but étant que dans le plan d'entrainement, l'ia me recommande des repas avec les score nutritionnel qu'il faut. Une petit explication. Je pourrais lui demander des détails sur les repas comme la recette ou lui demander de changer dans l'onglet chat.

- [ ] **Amélioration du chatbot** - Le but c'est que le chatbot ai maintenant accés a des fonctions : créer un plan, modifier un plan, modifier la nutrition, d'autres fonctions a voir si pertinante. A chaque fois un bouton de confirmation dans la conversation apparait pour confirmer. Le but pouvoir discuter avec le coach et qu'il modifie donc l'entrainement.

## Bugs

- [ ] **`Could not find the 'steps' column of 'plan_workouts' in the schema cache`** lors
  de la création d'un plan.
  - Cause probable : migrations non appliquées sur la base de prod (la colonne `steps`
    vient de `0007_plan_workout_steps.sql` ; voir aussi `0008` et `0009`).
  - À faire : appliquer les migrations `0007` → `0009` sur le projet Supabase, puis
    recharger le cache de schéma PostgREST (Supabase → API → « Reload schema », ou
    `NOTIFY pgrst, 'reload schema';`).
  - Vérifier l'application de toutes les migrations avant chaque déploiement.
