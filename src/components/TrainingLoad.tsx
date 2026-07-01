import { useEffect, useState } from "react";
import { getTrainingLoad, type LoadBalance, type LoadStatus } from "../lib/api";

const STATUS: Record<LoadStatus, { label: string; text: string; bg: string; dot: string }> = {
  detraining: {
    label: "Sous-charge",
    text: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-950",
    dot: "bg-sky-500",
  },
  optimal: {
    label: "Optimale",
    text: "text-green-600 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-950",
    dot: "bg-green-500",
  },
  high: {
    label: "Élevée",
    text: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-950",
    dot: "bg-orange-500",
  },
  very_high: {
    label: "Très élevée",
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950",
    dot: "bg-red-500",
  },
};

const asBalance = (b: LoadBalance | Record<string, never>): LoadBalance | null =>
  "acwr" in b ? (b as LoadBalance) : null;

/** Carte « Charge d'entraînement » : ACWR (aiguë/chronique) + barres hebdo. */
export default function TrainingLoad() {
  const [bal, setBal] = useState<LoadBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTrainingLoad()
      .then((b) => setBal(asBalance(b)))
      .catch(() => setBal(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !bal || bal.acwr == null) return null;

  const st = bal.status ? STATUS[bal.status] : null;
  const maxLoad = Math.max(1, ...bal.weekly.map((w) => w.load));

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
          <ion-icon name="pulse-outline" className="text-base text-green-600"></ion-icon>
          Charge d'entraînement
        </h2>
        {st && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.bg} ${st.text}`}>
            {st.label}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <div className={`text-3xl font-semibold tabular-nums ${st?.text ?? ""}`}>{bal.acwr}</div>
          <div className="text-xs text-neutral-400">ratio charge aiguë / chronique (ACWR)</div>
        </div>
        <div className="text-sm text-neutral-600 dark:text-neutral-300">
          <div>
            7 j : <span className="font-medium tabular-nums">{bal.acute_7d}</span>
            {bal.trend_pct != null && (
              <span
                className={
                  bal.trend_pct >= 0
                    ? "ml-1 text-orange-500"
                    : "ml-1 text-sky-500"
                }
              >
                ({bal.trend_pct >= 0 ? "+" : ""}
                {bal.trend_pct}%)
              </span>
            )}
          </div>
          <div>
            Moyenne 4 sem. : <span className="font-medium tabular-nums">{bal.chronic_weekly}</span>/sem.
          </div>
        </div>
      </div>

      {/* Barres hebdomadaires */}
      <div className="mt-5 flex items-end gap-1.5" style={{ height: 56 }}>
        {bal.weekly.map((w, i) => {
          const last = i === bal.weekly.length - 1;
          return (
            <div key={w.start} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`w-full rounded-t ${last ? st?.dot ?? "bg-neutral-400" : "bg-neutral-200 dark:bg-neutral-700"}`}
                style={{ height: `${Math.max(3, (w.load / maxLoad) * 44)}px` }}
                title={`${w.load} — semaine du ${w.start}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
        <span>−6 sem.</span>
        <span>cette sem.</span>
      </div>

      <p className="mt-4 text-xs text-neutral-400">
        Zone optimale ~0,8–1,3. Au-dessus de 1,5, le risque de blessure augmente ; en dessous de
        0,8, tu perds de la forme. Le coach en tient compte.
      </p>
    </section>
  );
}
