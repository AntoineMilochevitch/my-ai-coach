/**
 * Prédiction de performance (chronos réalistes) via le modèle VDOT de Jack Daniels.
 *
 * On résout, pour un VDOT donné et une distance d, le temps T tel que la VO2 exigée
 * à l'allure d/T corresponde au pourcentage de VO2max soutenable sur cette durée :
 *   VO2(d/T) = VDOT · %VO2max(T)
 * avec %VO2max(T) = 0.8 + 0.1894393·e^(-0.012778·T) + 0.2989558·e^(-0.1932605·T)  (T en min)
 * et   VO2(V)     = -4.60 + 0.182258·V + 0.000104·V²                              (V en m/min).
 *
 * VDOT effectif = VO2max Garmin si dispo, sinon dernière VO2max synchro, sinon estimée
 * depuis la meilleure course récente (mêmes formules).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RacePrediction {
  label: string;
  distance_m: number;
  time_s: number;
  pace_s_per_km: number;
}
export interface Predictions {
  vdot: number;
  source: string; // "Garmin VO₂max" | "VO₂max synchronisée" | "estimé (meilleure course)"
  races: RacePrediction[];
}

const DISTANCES: { label: string; d: number }[] = [
  { label: "5 km", d: 5000 },
  { label: "10 km", d: 10000 },
  { label: "Semi", d: 21097 },
  { label: "Marathon", d: 42195 },
];

const pctVo2 = (tMin: number) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
const vo2AtSpeed = (vMetersPerMin: number) =>
  -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin * vMetersPerMin;

/** Temps (secondes) pour courir `d` mètres à un VDOT donné (bisection). */
function solveTimeSec(vdot: number, d: number): number {
  let lo = 3; // min (rapide)
  let hi = 600; // min (lent)
  const g = (tMin: number) => vo2AtSpeed(d / tMin) - vdot * pctVo2(tMin);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 60;
}

export function predictRaces(vdot: number): RacePrediction[] {
  return DISTANCES.map(({ label, d }) => {
    const time = solveTimeSec(vdot, d);
    return {
      label,
      distance_m: d,
      time_s: Math.round(time),
      pace_s_per_km: time / (d / 1000),
    };
  });
}

/** Estime un VDOT depuis la meilleure course récente (≥ 1,5 km, ≥ 5 min). */
function estimateVdotFromRaces(acts: any[]): number | null {
  let best = 0;
  for (const a of acts) {
    if (!a.activity_type?.includes("running")) continue;
    const dist = a.distance_m;
    const dur = a.duration_s;
    if (!dist || !dur || dist < 1500 || dur < 300) continue;
    const tMin = dur / 60;
    const v = dist / tMin;
    const vo2max = vo2AtSpeed(v) / pctVo2(tMin);
    if (vo2max > best) best = vo2max;
  }
  return best > 0 ? Math.round(best * 10) / 10 : null;
}

export async function racePredictions(sb: SupabaseClient, userId: string): Promise<Predictions | null> {
  // 1) VO2max Garmin (course) si présent.
  const { data: prof } = await sb
    .from("profiles")
    .select("garmin_zones")
    .eq("id", userId)
    .maybeSingle();
  const gzVo2 = Number((prof?.garmin_zones as any)?.vo2_running);
  let vdot: number | null = Number.isFinite(gzVo2) && gzVo2 > 0 ? gzVo2 : null;
  let source = "Garmin VO₂max";

  // 2) Dernière VO2max synchronisée.
  if (vdot == null) {
    const { data: dm } = await sb
      .from("daily_metrics")
      .select("vo2max, vo2max_source")
      .eq("user_id", userId)
      .not("vo2max", "is", null)
      .order("metric_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dm?.vo2max) {
      vdot = Number(dm.vo2max);
      source = dm.vo2max_source === "calculated" ? "estimé (meilleure course)" : "VO₂max synchronisée";
    }
  }

  // 3) Estimation depuis les courses récentes.
  if (vdot == null) {
    const since = new Date(Date.now() - 120 * 86400000).toISOString();
    const { data: acts } = await sb
      .from("activities")
      .select("activity_type, distance_m, duration_s")
      .eq("user_id", userId)
      .gte("start_time", since);
    const est = estimateVdotFromRaces(acts ?? []);
    if (est) {
      vdot = est;
      source = "estimé (meilleure course)";
    }
  }

  if (vdot == null || vdot <= 0) return null;
  return { vdot: Math.round(vdot * 10) / 10, source, races: predictRaces(vdot) };
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Ligne texte compacte pour le contexte IA. "" si non calculable. */
export function predictText(p: Predictions | null): string {
  if (!p) return "";
  const races = p.races.map((r) => `${r.label} ${fmtTime(r.time_s)}`).join(", ");
  return `Chronos réalistes (VDOT ${p.vdot}, ${p.source}) : ${races}`;
}
