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
  hr_max_source: string | null; // "mesurée" | "estimée (220 - âge)"
  resting_hr: number | null;
  vo2max: number | null;
  hr: { method: string; zones: HrZone[] } | null;
  pace: { method: string; zones: PaceZone[] } | null;
}

function fmtPace(secPerKm: number | null): string {
  if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm <= 0) return "n/a";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/**
 * Allure (s/km) pour une fraction `frac` de la VO2max, via la relation vitesse↔VO2
 * de Daniels : VO2 = -4.60 + 0.182258·v + 0.000104·v²  (v en m/min).
 */
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

export async function athleteZones(sb: SupabaseClient, userId: string): Promise<Zones | null> {
  // Âge (profil).
  const { data: prof } = await sb
    .from("profiles")
    .select("birth_date")
    .eq("id", userId)
    .maybeSingle();
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
  const restingHr: number | null = dm?.resting_hr ?? null;

  // VO2max le plus récent non nul.
  let vo2max: number | null = dm?.vo2max ?? null;
  if (vo2max == null) {
    const { data: v } = await sb
      .from("daily_metrics")
      .select("vo2max")
      .eq("user_id", userId)
      .not("vo2max", "is", null)
      .order("metric_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    vo2max = v?.vo2max ?? null;
  }

  const hrMax = measuredMax ?? (age ? 220 - age : null);
  const hrMaxSource = measuredMax ? "mesurée" : age ? "estimée (220 - âge)" : null;

  // Zones de FC.
  let hr: Zones["hr"] = null;
  if (hrMax) {
    const rest = restingHr ?? 0;
    const reserve = hrMax - rest;
    const zones: HrZone[] = HR_BOUNDS.slice(0, 5).map((lo, i) => ({
      n: i + 1,
      label: HR_LABELS[i],
      min: Math.round(rest + reserve * lo),
      max: Math.round(rest + reserve * HR_BOUNDS[i + 1]),
    }));
    hr = {
      method: restingHr ? "Karvonen (réserve de FC)" : "% de la FCmax",
      zones,
    };
  }

  // Zones d'allure (course) via VDOT.
  let pace: Zones["pace"] = null;
  if (vo2max && vo2max > 0) {
    pace = {
      method: `VDOT ≈ ${Math.round(vo2max)}`,
      zones: PACE_ZONES.map((z) => ({ label: z.label, pace: fmtPace(paceFromVdot(vo2max!, z.frac)) })),
    };
  }

  if (!hr && !pace) return null;
  return { hr_max: hrMax, hr_max_source: hrMaxSource, resting_hr: restingHr, vo2max, hr, pace };
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
