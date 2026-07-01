/**
 * Zones personnalisées de l'athlète, calculées à partir de SES données :
 *  - Zones de FC (5) : méthode de Karvonen (réserve de FC) si FC repos connue,
 *    sinon en % de la FCmax. FCmax = mesurée (max des activités) ou estimée (220 - âge).
 *  - Zones d'allure (course) : d'après le VDOT ≈ VO2max (modèle de Jack Daniels).
 *
 * Aucune table dédiée : tout est dérivé de profiles / activities / daily_metrics,
 * donc toujours à jour. Utilisé pour l'affichage (endpoint) et le contexte IA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface HrZone {
  n: number;
  label: string;
  min: number;
  max: number;
}
export interface PaceZone {
  label: string;
  pace: string; // m:ss/km
}
export interface Zones {
  hr_max: number | null;
  hr_max_source: string | null; // "Garmin" | "mesurée" | "estimée (220 - âge)"
  resting_hr: number | null;
  vo2max: number | null;
  hr: { method: string; zones: HrZone[] } | null;
  pace: { method: string; zones: PaceZone[] } | null;
  // Résumé de ce qui a été récupéré depuis Garmin (null si rien de branché).
  garmin: {
    threshold_pace: string | null;
    lthr: number | null;
    hr_max: number | null;
    has_hr_floors: boolean;
    fetched_at: string | null;
  } | null;
}

function fmtPace(secPerKm: number | null): string {
  if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm <= 0) return "n/a";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function toNum(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Allure (s/km) pour une fraction `frac` de la VO2max, via la relation vitesse↔VO2
 * de Daniels : VO2 = -4.60 + 0.182258·v + 0.000104·v²  (v en m/min).
 */
/**
 * Ramène une "vitesse seuil" Garmin à des m/s plausibles pour de la course.
 * Garmin renvoie parfois des unités surprenantes (m/s attendu, mais on a observé
 * un facteur 10, et km/h est possible). On teste des interprétations et on garde
 * la première qui tombe dans une plage de course réaliste (~1,4–7 m/s ≈ 2:23–11:54/km).
 * Renvoie null si aucune interprétation n'est crédible (→ repli VDOT).
 */
function plausibleRunSpeedMps(raw: number): number | null {
  for (const spd of [raw, raw * 10, raw / 3.6, raw * 3.6, raw / 10]) {
    if (spd >= 1.4 && spd <= 7.0) return spd;
  }
  return null;
}

function paceFromVdot(vdot: number, frac: number): number | null {
  const targetVo2 = frac * vdot;
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - targetVo2;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return null;
  const v = (-b + Math.sqrt(disc)) / (2 * a); // m/min
  if (v <= 0) return null;
  return (1000 / v) * 60; // s/km
}

const HR_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const HR_LABELS = [
  "Z1 · Récupération",
  "Z2 · Endurance fondamentale",
  "Z3 · Endurance active / Tempo",
  "Z4 · Seuil",
  "Z5 · VO2max",
];
const PACE_ZONES: { label: string; frac: number }[] = [
  { label: "Facile / Endurance", frac: 0.7 },
  { label: "Marathon", frac: 0.8 },
  { label: "Seuil", frac: 0.87 },
  { label: "Intervalle (VO2max)", frac: 0.97 },
  { label: "Vitesse / Répétition", frac: 1.05 },
];

// Allures = multiplicateurs de l'allure SEUIL (T, s/km). >1 = plus lent.
const PACE_FROM_THRESHOLD: { label: string; mult: number }[] = [
  { label: "Facile / Endurance", mult: 1.2 },
  { label: "Marathon", mult: 1.06 },
  { label: "Seuil", mult: 1.0 },
  { label: "Intervalle (VO2max)", mult: 0.94 },
  { label: "Vitesse / Répétition", mult: 0.9 },
];

export async function athleteZones(sb: SupabaseClient, userId: string): Promise<Zones | null> {
  // Âge (profil) + zones récupérées de Garmin (prioritaires si présentes).
  const { data: prof } = await sb
    .from("profiles")
    .select("birth_date, garmin_zones")
    .eq("id", userId)
    .maybeSingle();
  const gz: any = prof?.garmin_zones ?? null;
  let age: number | null = null;
  if (prof?.birth_date) {
    const b = new Date(`${prof.birth_date}T00:00:00Z`);
    if (!Number.isNaN(b.getTime())) {
      const now = new Date();
      age = now.getUTCFullYear() - b.getUTCFullYear();
      if (
        now.getUTCMonth() < b.getUTCMonth() ||
        (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())
      )
        age--;
    }
  }

  // FCmax mesurée (max des activités récentes).
  const { data: hrRow } = await sb
    .from("activities")
    .select("max_hr")
    .eq("user_id", userId)
    .not("max_hr", "is", null)
    .order("max_hr", { ascending: false })
    .limit(1)
    .maybeSingle();
  const measuredMax: number | null = hrRow?.max_hr ?? null;

  // FC repos + VO2max (dernière métrique disponible).
  const { data: dm } = await sb
    .from("daily_metrics")
    .select("resting_hr, vo2max")
    .eq("user_id", userId)
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  // VO2max le plus récent non nul.
  let vo2maxMetric: number | null = toNum(dm?.vo2max);
  if (vo2maxMetric == null) {
    const { data: v } = await sb
      .from("daily_metrics")
      .select("vo2max")
      .eq("user_id", userId)
      .not("vo2max", "is", null)
      .order("metric_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    vo2maxMetric = toNum(v?.vo2max);
  }

  // Valeurs Garmin (prioritaires).
  const gzHrMax = toNum(gz?.hr_max);
  const gzThrSpeedRaw = toNum(gz?.threshold_speed_mps);
  const gzThrSpeed = gzThrSpeedRaw ? plausibleRunSpeedMps(gzThrSpeedRaw) : null; // m/s normalisé
  const gzLthr = toNum(gz?.lthr);
  const gzFloors: number[] | null =
    Array.isArray(gz?.hr_floors) && gz.hr_floors.length === 5 && gz.hr_floors.every((x: unknown) => toNum(x))
      ? gz.hr_floors.map(Number)
      : null;

  const restingHr: number | null = toNum(gz?.resting_hr) ?? toNum(dm?.resting_hr);
  const vo2max: number | null = toNum(gz?.vo2_running) ?? vo2maxMetric;

  const hrMax = gzHrMax ?? measuredMax ?? (age ? 220 - age : null);
  const hrMaxSource = gzHrMax
    ? "Garmin"
    : measuredMax
      ? "mesurée"
      : age
        ? "estimée (220 - âge)"
        : null;

  // --- Zones de FC ---
  let hr: Zones["hr"] = null;
  if (gzFloors) {
    // Bornes EXACTES de la montre.
    const top = hrMax ?? Math.round(gzFloors[4] * 1.05);
    hr = {
      method: `Garmin — montre${gz?.hr_zone_sport ? ` (${gz.hr_zone_sport})` : ""}`,
      zones: gzFloors.map((lo, i) => ({
        n: i + 1,
        label: HR_LABELS[i],
        min: Math.round(lo),
        max: i < 4 ? Math.round(gzFloors[i + 1]) : top,
      })),
    };
  } else if (hrMax) {
    const rest = restingHr ?? 0;
    const reserve = hrMax - rest;
    hr = {
      method: restingHr ? "Karvonen (réserve de FC)" : "% de la FCmax",
      zones: HR_BOUNDS.slice(0, 5).map((lo, i) => ({
        n: i + 1,
        label: HR_LABELS[i],
        min: Math.round(rest + reserve * lo),
        max: Math.round(rest + reserve * HR_BOUNDS[i + 1]),
      })),
    };
  }

  // --- Zones d'allure (course) ---
  let pace: Zones["pace"] = null;
  if (gzThrSpeed) {
    // À partir de l'allure SEUIL de Garmin (la plus "réglo").
    const t = 1000 / gzThrSpeed; // s/km au seuil
    pace = {
      method: `Garmin — seuil ${fmtPace(t)}`,
      zones: PACE_FROM_THRESHOLD.map((z) => ({ label: z.label, pace: fmtPace(t * z.mult) })),
    };
  } else if (vo2max && vo2max > 0) {
    pace = {
      method: `VDOT ≈ ${Math.round(vo2max)}`,
      zones: PACE_ZONES.map((z) => ({ label: z.label, pace: fmtPace(paceFromVdot(vo2max, z.frac)) })),
    };
  }

  const garmin: Zones["garmin"] = gz
    ? {
        threshold_pace: gzThrSpeed ? fmtPace(1000 / gzThrSpeed) : null,
        lthr: gzLthr,
        hr_max: gzHrMax,
        has_hr_floors: !!gzFloors,
        fetched_at: gz.fetched_at ?? null,
      }
    : null;

  if (!hr && !pace) return null;
  return { hr_max: hrMax, hr_max_source: hrMaxSource, resting_hr: restingHr, vo2max, hr, pace, garmin };
}

/** Résumé texte compact pour le contexte IA. "" si rien de calculable. */
export function zonesText(z: Zones | null): string {
  if (!z) return "";
  const parts: string[] = [];
  if (z.hr) {
    const zs = z.hr.zones.map((x) => `${x.label.split(" · ")[0]} ${x.min}-${x.max}`).join(", ");
    parts.push(
      `Zones FC (FCmax ${z.hr_max} ${z.hr_max_source ?? ""}${z.resting_hr ? `, FC repos ${z.resting_hr}` : ""}, ${z.hr.method}) : ${zs} bpm`,
    );
  }
  if (z.pace) {
    const ps = z.pace.zones.map((x) => `${x.label} ${x.pace}`).join(", ");
    parts.push(`Allures course (${z.pace.method}) : ${ps}`);
  }
  return parts.join(". ");
}
