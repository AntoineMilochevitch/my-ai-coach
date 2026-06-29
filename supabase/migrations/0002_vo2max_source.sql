-- my-ai-coach — ajoute la provenance du VO2max (garmin | calculated).
alter table public.daily_metrics
  add column if not exists vo2max_source text;
