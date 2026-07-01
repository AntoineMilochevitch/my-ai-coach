/**
 * Récupération des ZONES d'entraînement depuis Garmin Connect.
 *
 * Deux endpoints (confirmés côté web Garmin), tous deux BEST-EFFORT :
 *   - /userprofile-service/userprofile/user-settings  → seuils (LTHR, allure seuil),
 *     FCmax, VO2max… (source la plus "réglo" pour les allures de course).
 *   - /biometric-service/heartRateZones               → bornes exactes des zones FC
 *     par sport (floors), si l'endpoint répond.
 *
 * Les noms de champs Garmin ne sont pas documentés : on lit de façon DÉFENSIVE
 * (plusieurs candidats) et on conserve le brut (`debug`) pour affiner au besoin.
 * En cas d'échec/absence → renvoie null (le calcul maison prend le relais).
 */
import { connectApi } from "./auth.ts";

export interface GarminZonesRaw {
  hr_max: number | null;
  resting_hr: number | null;
  lthr: number | null; // FC au seuil lactique
  threshold_speed_mps: number | null; // allure seuil (vitesse, m/s)
  vo2_running: number | null;
  hr_floors: number[] | null; // [z1..z5] bornes basses (bpm)
  hr_zone_sport: string | null;
  fetched_at: string;
  debug: Record<string, unknown>;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Premier champ non nul parmi une liste de candidats. */
function pick(obj: any, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) if (obj[k] != null) return obj[k];
  return null;
}

/** connectApi borné dans le temps (ne peut pas bloquer une fonction longtemps). */
async function timed<T>(p: Promise<T>, ms = 8000): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

export async function fetchGarminZones(accessToken: string): Promise<GarminZonesRaw | null> {
  const [settings, hrZonesRaw] = await Promise.all([
    timed(connectApi<any>(accessToken, "/userprofile-service/userprofile/user-settings")),
    timed(connectApi<any>(accessToken, "/biometric-service/heartRateZones")),
  ]);

  const ud = settings?.userData ?? settings ?? null;
  if (!ud && !hrZonesRaw) return null;

  const hrMaxSettings = num(pick(ud, ["userMaxHeartRate", "maxHeartRate", "maxHr"]));
  const lthr = num(pick(ud, ["lactateThresholdHeartRate"]));
  const restHr = num(pick(ud, ["restingHeartRate"]));
  const thrSpeed = num(pick(ud, ["lactateThresholdSpeed", "runningLactateThresholdSpeed"]));
  const vo2Run = num(pick(ud, ["vo2MaxRunning", "vo2Max", "vo2max"]));

  // Bornes exactes des zones FC (course de préférence, sinon DEFAULT / première).
  let hrFloors: number[] | null = null;
  let hrZoneMax: number | null = null;
  let hrZoneSport: string | null = null;
  if (Array.isArray(hrZonesRaw) && hrZonesRaw.length) {
    const z =
      hrZonesRaw.find((x: any) => x?.sport === "RUNNING") ??
      hrZonesRaw.find((x: any) => x?.sport === "DEFAULT") ??
      hrZonesRaw[0];
    if (z) {
      const f = [z.zone1Floor, z.zone2Floor, z.zone3Floor, z.zone4Floor, z.zone5Floor].map(num);
      if (f.every((x) => x != null)) {
        hrFloors = f as number[];
        hrZoneMax = num(z.maxHeartRateUsed ?? z.maxHeartRate);
        hrZoneSport = z.sport ?? null;
      }
    }
  }

  return {
    hr_max: hrZoneMax ?? hrMaxSettings,
    resting_hr: restHr,
    lthr,
    threshold_speed_mps: thrSpeed,
    vo2_running: vo2Run,
    hr_floors: hrFloors,
    hr_zone_sport: hrZoneSport,
    fetched_at: new Date().toISOString(),
    // Brut conservé pour ajuster le mapping des champs si un jour ça ne remplit pas.
    debug: {
      userData_keys: ud && typeof ud === "object" ? Object.keys(ud) : null,
      heart_rate_zones: hrZonesRaw ?? null,
    },
  };
}
