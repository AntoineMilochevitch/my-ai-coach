-- =====================================================================
-- my-ai-coach — 0014 : données physiques du profil.
-- Sexe, taille, poids, date de naissance → permettent à l'IA d'être plus précise
-- (besoins caloriques, protéines/kg, zones FC, VO₂max normée…).
-- Lecture/écriture self (policies profiles existantes) ; lues par les Functions.
-- =====================================================================
alter table public.profiles
  add column if not exists sex        text,     -- 'M' | 'F' | 'other'
  add column if not exists height_cm  numeric,
  add column if not exists weight_kg  numeric,
  add column if not exists birth_date date;
