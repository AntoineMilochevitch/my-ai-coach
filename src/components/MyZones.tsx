import { useEffect, useState } from "react";
import { getZones, type Zones } from "../lib/api";

const ZONE_COLORS = [
  "bg-sky-500",
  "bg-green-500",
  "bg-yellow-500",
  "bg-orange-500",
  "bg-red-500",
];

/** Carte « Mes zones » : zones de FC (Karvonen) et d'allure (VDOT), calculées côté serveur. */
export default function MyZones() {
  const [zones, setZones] = useState<Zones | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getZones()
      .then((z) => setZones("hr" in z || "pace" in z ? (z as Zones) : null))
      .catch(() => setZones(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!zones || (!zones.hr && !zones.pace)) return null;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
          <ion-icon name="speedometer-outline" className="text-base text-green-600"></ion-icon>
          Mes zones
        </h2>
        <span className="text-xs text-neutral-400">
          {zones.hr_max && `FCmax ${zones.hr_max} (${zones.hr_max_source})`}
          {zones.resting_hr ? ` · FC repos ${zones.resting_hr}` : ""}
          {zones.vo2max ? ` · VO₂max ${Math.round(zones.vo2max)}` : ""}
        </span>
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

      <p className="mt-4 text-xs text-neutral-400">
        Estimées depuis tes données (FCmax mesurée, FC repos, VO₂max). Le coach s'en sert pour
        calibrer tes séances.
      </p>
    </section>
  );
}
