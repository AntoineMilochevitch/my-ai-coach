-- =====================================================================
-- my-ai-coach — 0016 : zones d'entraînement récupérées depuis Garmin Connect.
-- Stocke le brut normalisé (FCmax, FC repos, seuil FC/allure, floors de zones FC)
-- lu via l'API Garmin (user-settings + heartRateZones). Utilisé en priorité par le
-- calcul des zones (repli sur le calcul maison si absent). Écrit par les Functions.
-- =====================================================================
alter table public.profiles add column if not exists garmin_zones jsonb;
