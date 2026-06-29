export interface Activity {
  id: string;
  garmin_activity_id: number;
  activity_type: string | null;
  start_time: string | null;
  distance_m: number | null;
  duration_s: number | null;
  avg_hr: number | null;
  avg_pace_s_per_km: number | null;
  training_load: number | null;
}
