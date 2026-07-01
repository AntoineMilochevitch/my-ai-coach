# TODO

## Fonctionnalités

- [x] **Apport nutritionnel généré par l'IA** — faire estimer par le modèle les valeurs nutritionnelles (calories, protéines, glucides, lipides) d'un repas à partir de sa description, au lieu d'une saisie manuelle. *(Fait : endpoint `estimate-nutrition` + bouton « Estimer les valeurs (IA) » sur la page Nutrition.)*

- [x] **Tutoriel interactif** — parcours guidé à la première connexion : présentation du site, connexion à Garmin, mise en place de la clé API IA et choix du modèle, première synchronisation, génération d'un plan. *(Fait : modale d'onboarding sur le Dashboard avec checklist à statut live (clé IA + modèle, Garmin, synchro, plan) et boutons de raccourci ; persistance via `profiles.settings.onboarded` ; bouton « Revoir le tutoriel » dans le Profil.)*

- [x] **Onglet Planning** — vue calendrier dédiée des séances (semaine / mois), distincte de la liste du plan. *(Fait : page `/planning`, vues semaine/mois, clic sur une séance → modale de détail (étapes, cible, envoi Garmin, marquer faite).)*

- [x] **Création d'activité depuis le chat** - le coach peut créer des activités depuis le chat, qu'on peut directement envoyé à la montre. *(Fait : action `create_workout` → étapes générées par IA + envoi Garmin ; et `edit_workout` pour modifier une séance précise du plan. Endpoints `create-workout` / `edit-workout`.)*

- [x] **logo** - Faire un prompt pour générer un logo pour le site et le mettre dans le site et en favicon. *(Fait : logo SVG `src/components/Logo.tsx` dans l'en-tête + `public/favicon.svg`. Prompt de génération fourni si remplacement par un logo IA souhaité.)*

- [x] **Nutrition pendant l'effort** - inclure un plan de nutrition pendant l'effort (optionnel que l'utilisateur peut demander ou non), et après chaque activité, la possibilité, en plus d'ajouté sont ressenti, dire si on a mangé et bu, quoi, et les valeur nutritionnelle. *(Fait : case « Inclure le ravitaillement pendant l'effort » dans le plan nutrition (section `pendant_effort` par durée de séance) ; journal post-activité `activity_logs` (ressenti + mangé/bu, quoi, glucides/liquides/kcal) via un bouton « Noter » sur chaque activité du Dashboard ; le coach a ces journaux en contexte. Migration 0013.)*

- [x] **Améliorer la nutrition** - Le but étant que dans le plan d'entrainement, l'ia me recommande des repas avec les score nutritionnel qu'il faut. Une petit explication. Je pourrais lui demander des détails sur les repas comme la recette ou lui demander de changer dans l'onglet chat. *(Fait : `nutrition-plan-background` génère un plan (besoins par type de jour + repas type avec macros cibles + idées + explications) ; section « Plan nutrition (IA) » sur la page Nutrition ; action chat `nutrition_plan` pour générer/adapter, et le coach a le plan en contexte pour donner recettes/ajustements. Migration 0012.)*

- [x] **Amélioration du chatbot** - Le but c'est que le chatbot ai maintenant accés a des fonctions : créer un plan, modifier un plan, modifier la nutrition, d'autres fonctions a voir si pertinante. A chaque fois un bouton de confirmation dans la conversation apparait pour confirmer. Le but pouvoir discuter avec le coach et qu'il modifie donc l'entrainement. *(Fait : actions confirmables `create_plan`, `adapt_plan`, `add_nutrition`, `add_note` via classifieur IA + carte Confirmer/Annuler dans le chat. Migration 0010. À étendre plus tard : édition d'une séance précise, et fonctions supplémentaires.)*

- [x] **Model IA** - switch automatiquement de modèle quand il y a des erreurs avec le modèle pour que ça soit invisible pour l'utilisateur. *(Fait : repli automatique dans `getLlm` sur limite (429) ou modèle indisponible (403/404) → modèle suivant du même fournisseur ; 429 sans retry pour éviter les timeouts 504 ; message clair si toutes les limites sont atteintes.)*

- [x] **Profil physique** - sexe, âge, taille, poids → contexte IA plus précis (macros g/kg, besoins caloriques…). *(Fait : section « Mes informations » + migration 0014 + branché dans plan/nutrition/chat/analyses.)*

## Roadmap améliorations (ordre de réalisation)

- [x] **1. Coach proactif** — le coach vient à toi : message/bilan automatique (dernière séance commentée, alerte si signal, 1 conseil) sur le Dashboard, généré avec parcimonie (seulement si périmé). Inclut l'**analyse auto post-séance** et la **carte « Message du coach »**. *(Fait : `coach-insight-background` (court, 1 appel) + table `coach_insights` (0015) + carte `CoachInsight` en haut du Dashboard, auto-générée seulement si ≥ 20 h et données présentes, + bouton Actualiser.)*
- [ ] **2. Zones perso FC & allure** — récupérer les zones depuis Garmin (ou les calculer) et les utiliser dans les séances + les afficher.
- [ ] **3. Détection de surcharge** — ratio charge aiguë/chronique (ACWR) + tendances récup → alerte (alimente le coach proactif).
- [ ] **4. Prédiction de performance** — estimer des chronos réalistes (VDOT) et aider à fixer l'objectif.
- [ ] **5. Mémoire du coach** — profil athlète persistant (objectifs, blessures, préférences) que le coach met à jour et réutilise entre conversations.
- [ ] **6. Graphes de récupération** — HRV, readiness, sommeil, charge, poids sur le Dashboard.
- [ ] **7. Page détail d'activité** — clic sur une activité → détail complet (splits, FC, TE) + journal ressenti/ravito.
- [ ] **8. Thème clair / sombre** — toggle dédié (au lieu de suivre le système).
