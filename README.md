# my-ai-coach

Dashboard de suivi sportif (running/fitness) boosté à l'IA : agrège les données
**Garmin Connect**, les visualise, et fournit analyse + coaching via **Gemini**.

**Stack** : React + Vite (Netlify) · Netlify Functions (serverless, secrets côté
serveur) · Supabase (Postgres + pgvector + Auth + RLS) · Gemini.
**Aucun secret côté client.** Conçu multi-utilisateurs (RLS par `user_id`).
