# my-ai-coach

Application web de coaching sportif (course à pied / fitness) assistée par IA. Elle agrège les données **Garmin Connect**, les visualise, et fournit analyse, coaching conversationnel, plan d'entraînement adaptatif et conseils nutrition via un modèle de langage configurable (**Gemini**, **Claude** ou **OpenAI**).

Conçue multi-utilisateurs dès l'origine (isolation par `user_id` via RLS). Aucun secret n'est exposé au navigateur.

---

## Fonctionnalités

- **Tableau de bord** — agrégats d'activités (volume, allure, FC, VO₂max, records), graphes de tendances (volume, allure, FC), filtres par période et par sport.
- **Coach IA — analyse de période** — bilan structuré en Markdown (état de forme, points forts, vigilances, recommandations chiffrées) à partir des données récentes.
- **Chat coach** — conversation contextualisée par les données de l'athlète, le plan actif, les notes et un RAG sémantique (pgvector). Réponses générées en arrière-plan (robustes aux limites de débit, avec repli automatique de modèle), historique des conversations, titre généré automatiquement, édition et régénération des messages. **Actions confirmables** : le coach peut proposer de créer/adapter un plan, ajouter un repas ou une note, créer et envoyer une séance sur la montre, ou modifier une séance précise — validés par l'athlète depuis la conversation.
- **Plan d'entraînement adaptatif glissant** — squelette de périodisation (macro) généré une fois, détail des séances matérialisé sur une fenêtre de quelques semaines, ré-adapté à l'état de forme réel (réalisé vs cible, récupération, nutrition, notes)
  manuellement ou automatiquement chaque semaine. Téléversement des séances structurées vers Garmin Connect.
- **Nutrition** — saisie des repas et conseils IA croisés avec la charge d'entraînement.
- **Notes & ressenti** — saisie de texte libre (fatigue, douleurs, contexte) intégré au RAG et au coaching.
- **Intégration Garmin Connect** — connexion (identifiants + MFA), synchronisation des activités, métriques quotidiennes et sommeil, synchronisation planifiée horaire.
- **IA multi-fournisseurs** — Gemini, Anthropic (Claude) ou OpenAI ; clé API par utilisateur, chiffrée au repos ; choix du modèle via l'interface.
- **Quotas IA** — compteurs par utilisateur et par jour, suivi de la consommation de tokens.

---

## Pile technique

| Couche | Technologies |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, Tailwind CSS 4, React Router, react-markdown, Recharts |
| Backend | Netlify Functions (serverless, ESM `.mts`, bundler esbuild), Node ≥ 22 |
| Base de données | Supabase — PostgreSQL, pgvector, Auth, Row Level Security |
| IA | Gemini, Claude, OpenAI (API REST) ; embeddings `text-embedding-004` / `text-embedding-3-small` (768 dimensions) |
| Sécurité | Chiffrement AES-256-GCM (`node:crypto`) des secrets au repos ; clé `service_role` côté serveur uniquement ; clé `anon` côté client (protégée par la RLS) |

---

## Architecture

```
Navigateur (SPA React, clé anon)
        │  lectures directes Supabase (RLS user_id = auth.uid())
        │  appels POST authentifiés (JWT Supabase)
        ▼
Netlify Functions (service_role, secrets serveur)
        │  vérifient le JWT, scopent les requêtes au user
        ├── APIs IA  → Gemini / Claude / OpenAI
        ├── Garmin   → Garmin Connect
        └── Supabase → PostgreSQL + pgvector
```

- Les **écritures sensibles** (sync Garmin, génération IA, embeddings) passent par les Functions avec la clé `service_role` (qui contourne la RLS), toujours scopées au `user_id` issu du JWT vérifié.
- Les **lectures** se font directement depuis le navigateur via la clé `anon`, la RLS garantissant l'isolation par utilisateur.
- Deux **fonctions planifiées** : synchronisation Garmin horaire (`scheduled-sync`) et adaptation hebdomadaire des plans (`scheduled-adapt`).

---

## Structure du projet

```
my-ai-coach/
├── src/                         # Frontend React (SPA)
│   ├── pages/                   # Dashboard, Chat, Plan, Planning, Nutrition, Profile, Login
│   ├── components/              # Layout, Charts, GarminPanel, CoachAnalysis, Notes, …
│   └── lib/                     # client Supabase, auth, appels API, types, formatage
├── netlify/functions/          # Endpoints serverless
│   ├── _shared/                # code partagé
│   │   ├── llm/                # abstraction multi-provider (gemini, anthropic, openai)
│   │   ├── garmin/             # auth, tokens, sync Garmin
│   │   ├── ai-config.ts        # config IA par utilisateur (clé, modèle, provider, tz)
│   │   ├── plan-*.ts           # schémas, contexte, génération et adaptation du plan
│   │   ├── embeddings.ts       # embeddings RAG multi-provider
│   │   ├── usage.ts            # quotas et suivi des tokens
│   │   ├── crypto.ts           # chiffrement AES-256-GCM
│   │   ├── dates.ts            # dates calendaires dans le fuseau de l'athlète
│   │   └── supabase.ts         # client service_role + vérification JWT
│   ├── ai-analyze-background.mts     # analyse de période (arrière-plan)
│   ├── chat-background.mts      # chat coach (arrière-plan + RAG)
│   ├── name-conversation.mts   # titre de conversation généré par l'IA
│   ├── nutrition-advice-background.mts # conseils nutrition (arrière-plan)
│   ├── generate-plan-background.mts  # création du plan (macro + détail initial)
│   ├── adapt-plan-background.mts     # adaptation manuelle du plan
│   ├── match-plan.mts          # rapprochement séances ↔ activités réalisées
│   ├── index-rag.mts           # indexation RAG (embeddings)
│   ├── list-models.mts         # liste/validation des modèles d'un provider
│   ├── set-ai-config.mts       # enregistrement de la config IA
│   ├── garmin-login.mts        # connexion Garmin
│   ├── garmin-mfa.mts          # validation MFA Garmin
│   ├── garmin-sync.mts         # synchronisation Garmin
│   ├── garmin-push-workout.mts # téléversement des séances vers Garmin
│   ├── create-workout.mts      # crée une séance (IA) et l'envoie sur la montre
│   ├── edit-workout.mts        # modifie une séance précise du plan
│   ├── estimate-nutrition.mts  # estimation des macros d'un repas
│   ├── scheduled-sync.mts      # cron : sync Garmin horaire
│   └── scheduled-adapt.mts     # cron : adaptation hebdomadaire des plans
├── supabase/migrations/        # schéma SQL (0001 → 0011)
├── netlify.toml                # config de build et redirections SPA
└── vite.config.ts
```

---

## Modèle de données

PostgreSQL avec RLS activée sur toutes les tables.

| Table | Rôle | Accès |
|---|---|---|
| `profiles` | profil + préférences (`settings` : provider/modèle IA, fuseau, clés posées) | lecture/écriture self |
| `garmin_accounts` | statut de connexion Garmin | lecture self |
| `garmin_tokens` | jetons Garmin chiffrés | service_role uniquement |
| `garmin_login_sessions` | état MFA intermédiaire chiffré | service_role uniquement |
| `activities` | activités synchronisées | lecture self |
| `daily_metrics` | métriques quotidiennes (FC repos, HRV, VO₂max, readiness…) | lecture self |
| `sleep` | données de sommeil | lecture self |
| `nutrition_entries` | repas saisis | CRUD self |
| `training_notes` | notes libres / ressenti | CRUD self |
| `ai_analyses` | analyses générées | lecture self |
| `conversations`, `chat_messages` | historique du chat | lecture/insert/suppression self |
| `training_plans` | plan (objectif, macro de périodisation, dates, statut) | lecture/suppression self |
| `plan_workouts` | séances détaillées du plan | lecture self, mise à jour self |
| `rag_chunks` | embeddings du RAG (vector 768) | lecture self |
| `ai_secrets` | clés API IA chiffrées par provider | service_role uniquement |
| `ai_usage` | quotas et tokens par jour | lecture self |

Fonctions SQL : `match_rag_chunks` (recherche de similarité scopée user + modèle),
`bump_ai_usage` (incrément atomique des quotas), `handle_new_user` (création du profil),
`set_updated_at`.

---

## Couche IA

- **Abstraction multi-provider** (`netlify/functions/_shared/llm/`) : interface unique
  `generate` / `generateJSON` / `stream` pour Gemini, Claude et OpenAI, avec capture de
  l'usage en tokens et gestion des sorties tronquées.
- **Configuration par utilisateur** : provider et modèle dans `profiles.settings` ; clé
  API chiffrée dans `ai_secrets` (une colonne par provider). Repli sur une clé serveur
  réservé aux comptes listés dans `OWNER_EMAILS`.
- **RAG pgvector** : indexation multi-sources (activités, sommeil, métriques, nutrition,
  notes), modèle d'embedding mémorisé par chunk pour ne jamais mélanger des espaces
  vectoriels différents.
- **Plan adaptatif** : périodisation macro + détail roulant + ré-adaptation selon l'état
  de forme réel (voir `_shared/plan-*.ts`).
- **Quotas** : limites quotidiennes par type d'appel et journalisation des tokens.

---

## Variables d'environnement

| Variable | Portée | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | client (build) | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | client (build) | clé anon Supabase (protégée par la RLS) |
| `SUPABASE_URL` | serveur | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | serveur (secret) | clé service_role (contourne la RLS) |
| `TOKEN_ENCRYPTION_KEY` | serveur (secret) | clé AES, 32 octets encodés en base64 |
| `OWNER_EMAILS` | serveur | emails autorisés au repli sur la clé IA serveur |
| `GEMINI_API_KEY` | serveur | optionnel — clé Gemini de repli (comptes propriétaires) |
| `GEMINI_MODEL` | serveur | optionnel — modèle Gemini par défaut |

Les valeurs publiques (`VITE_*`, `SUPABASE_URL`) sont exclues du scan de secrets Netlify
via `SECRETS_SCAN_OMIT_KEYS` (`netlify.toml`).

---

## Développement local

```bash
npm install                 # dépendances
cp .env.example .env        # puis renseigner les variables
npm run dev                 # frontend Vite (sans les Functions)
netlify dev                 # frontend + Netlify Functions (recommandé)
```

Génération de la clé de chiffrement :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Scripts disponibles :

| Script | Action |
|---|---|
| `npm run dev` | serveur de développement Vite |
| `npm run build` | build de production (`dist/`) |
| `npm run preview` | prévisualisation du build |
| `npm run typecheck` | vérification TypeScript (`tsc --noEmit`) |

---

## Base de données

Le schéma est versionné dans `supabase/migrations/` (`0001` → `0011`). Les migrations
s'appliquent dans l'ordre sur le projet Supabase (SQL Editor ou `supabase db push`).
Après ajout de colonnes, le cache de schéma PostgREST doit être à jour (rechargement
automatique, ou « Reload schema » côté Supabase).

---

## Déploiement (Netlify)

- **Build** : `npm run build` · **Publish** : `dist` · **Functions** : `netlify/functions`.
- **Production** : branche `main`. **Pré-production** : branch deploy de `develop`
  (`https://develop--<site>.netlify.app`).
- Variables d'environnement définies au niveau du site ; clés sensibles marquées
  « secret », valeurs publiques laissées non-secrètes.
- Les fonctions planifiées (`scheduled-sync`, `scheduled-adapt`) s'exécutent sur le
  déploiement de production.

---

## Sécurité

- RLS stricte sur toutes les tables ; isolation par `user_id = auth.uid()`.
- Tables de secrets (`garmin_tokens`, `garmin_login_sessions`, `ai_secrets`) sans aucune
  policy : accessibles uniquement via la clé `service_role` (Functions).
- Secrets au repos chiffrés en AES-256-GCM ; clés et jetons jamais renvoyés au client.
- JWT Supabase vérifié côté serveur à chaque appel ; aucun `user_id` fourni par le client
  n'est jamais utilisé tel quel.
