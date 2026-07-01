import { useEffect, useState } from "react";
import { getZones, garminZonesRefresh, type Zones } from "../lib/api";

const ZONE_COLORS = [
  "bg-sky-500",
  "bg-green-500",
  "bg-yellow-500",
  "bg-orange-500",
  "bg-red-500",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asZones = (z: Zones | Record<string, never>): Zones | null =>
  "hr" in z || "pace" in z ? (z as Zones) : null;

/** Carte « Mes zones » : zones FC & allure, récupérées de Garmin si possible, sinon calculées. */
export default function MyZones() {
  const [zones, setZones] = useState<Zones | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    getZones()
      .then((z) => setZones(asZones(z)))
      .catch(() => setZones(null))
      .finally(() => setLoading(false));
  }, []);

  const refreshFromGarmin = async () => {
    setRefreshing(true);
    setError(null);
    setInfo(null);
    const baseline = zones?.garmin?.fetched_at ?? null;
    try {
      await garminZonesRefresh();
      const start = Date.now();
      for (;;) {
        await sleep(2500);
        const zz = asZones(await getZones());
        if (zz?.garmin?.fetched_at && zz.garmin.fetched_at !== baseline) {
          setZones(zz);
          setInfo(
            zz.garmin.threshold_pace || zz.garmin.has_hr_floors
              ? "Zones mises à jour depuis Garmin ✓"
              : "Garmin ne renvoie pas de zones exploitables — calcul maison conservé.",
          );
          break;
        }
        if (Date.now() - start > 40000) {
          if (zz) setZones(zz);
          setError(
            "Aucune zone Garmin récupérée (Garmin non connecté ou données indisponibles). Le calcul maison est conservé.",
          );
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return null;
  if (!zones || (!zones.hr && !zones.pace)) return null;

  const fromGarmin =
    zones.hr?.method.startsWith("Garmin") || zones.pace?.method.startsWith("Garmin");

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
          <ion-icon name="speedometer-outline" className="text-base text-green-600"></ion-icon>
          Mes zones
          {fromGarmin && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-950 dark:text-blue-300">
              Garmin
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-neutral-400 sm:inline">
            {zones.hr_max && `FCmax ${zones.hr_max} (${zones.hr_max_source})`}
            {zones.resting_hr ? ` · FC repos ${zones.resting_hr}` : ""}
            {zones.vo2max ? ` · VO₂max ${Math.round(zones.vo2max)}` : ""}
          </span>
          <button
            onClick={refreshFromGarmin}
            disabled={refreshing}
            className="flex items-center gap-1 text-xs text-neutral-500 underline hover:text-neutral-800 disabled:opacity-50 dark:hover:text-neutral-200"
          >
            <ion-icon name="watch-outline"></ion-icon>
            {refreshing ? "Récupération…" : "Récupérer depuis Garmin"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {zones.hr && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
              Fréquence cardiaque · {zones.hr.method}
            </h3>
            <ul className="space-y-1.5">
              {zones.hr.zones.map((z, i) => (
                <li key={z.n} className="flex items-center gap-2 text-sm">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ZONE_COLORS[i]}`} />
                  <span className="flex-1 text-neutral-600 dark:text-neutral-300">{z.label}</span>
                  <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
                    {z.min}–{z.max}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {zones.pace && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
              Allures course · {zones.pace.method}
            </h3>
            <ul className="space-y-1.5">
              {zones.pace.zones.map((z, i) => (
                <li key={z.label} className="flex items-center gap-2 text-sm">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ZONE_COLORS[i]}`} />
                  <span className="flex-1 text-neutral-600 dark:text-neutral-300">{z.label}</span>
                  <span className="font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
                    {z.pace}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {info && <p className="mt-4 text-xs text-green-600">{info}</p>}
      {error && <p className="mt-4 text-xs text-amber-600">{error}</p>}
      {!info && !error && (
        <p className="mt-4 text-xs text-neutral-400">
          {fromGarmin
            ? "Zones issues de ta montre Garmin. Le coach s'en sert pour calibrer tes séances."
            : "Estimées depuis tes données (FCmax, FC repos, VO₂max). « Récupérer depuis Garmin » pour utiliser les zones exactes de ta montre."}
        </p>
      )}
    </section>
  );
}
