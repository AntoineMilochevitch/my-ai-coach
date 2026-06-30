# TODO

## Fonctionnalités

- [x] **Apport nutritionnel généré par l'IA** — faire estimer par le modèle les valeurs nutritionnelles (calories, protéines, glucides, lipides) d'un repas à partir de sa description, au lieu d'une saisie manuelle. *(Fait : endpoint `estimate-nutrition` + bouton « Estimer les valeurs (IA) » sur la page Nutrition.)*

- [ ] **Tutoriel interactif** — parcours guidé à la première connexion : présentation du site, connexion à Garmin, mise en place de la clé API IA et choix du modèle, première synchronisation, génération d'un plan.

- [ ] **Onglet Planning** — vue calendrier dédiée des séances (semaine / mois), distincte de la liste du plan.

- [ ] **Création d'activité depuis le chat** - le coach peut créer des activités depuis le chat, qu'on peut directement envoyé à la montre

- [x] **logo** - Faire un prompt pour générer un logo pour le site et le mettre dans le site et en favicon. *(Fait : logo SVG `src/components/Logo.tsx` dans l'en-tête + `public/favicon.svg`. Prompt de génération fourni si remplacement par un logo IA souhaité.)*

- [ ] **Nutrition pendant l'effort** - inclure un plan de nutrition pendant l'effort (optionnel que l'utilisateur peut demander ou non), et après chaque activité, la possibilité, en plus d'ajouté sont ressenti, dire si on a mangé et bu, quoi, et les valeur nutritionnelle.

- [ ] **Améliorer la nutrition** - Le but étant que dans le plan d'entrainement, l'ia me recommande des repas avec les score nutritionnel qu'il faut. Une petit explication. Je pourrais lui demander des détails sur les repas comme la recette ou lui demander de changer dans l'onglet chat.

- [x] **Amélioration du chatbot** - Le but c'est que le chatbot ai maintenant accés a des fonctions : créer un plan, modifier un plan, modifier la nutrition, d'autres fonctions a voir si pertinante. A chaque fois un bouton de confirmation dans la conversation apparait pour confirmer. Le but pouvoir discuter avec le coach et qu'il modifie donc l'entrainement. *(Fait : actions confirmables `create_plan`, `adapt_plan`, `add_nutrition`, `add_note` via classifieur IA + carte Confirmer/Annuler dans le chat. Migration 0010. À étendre plus tard : édition d'une séance précise, et fonctions supplémentaires.)*

