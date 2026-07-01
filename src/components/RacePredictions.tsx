import { useEffect, useState } from "react";
import { getRacePredictions, type Predictions } from "../lib/api";

const asPred = (p: Predictions | Record<string, never>): Predictions | null =>
  "races" in p ? (p as Predictions) : null;

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtPace(sPerKm: number): string {
  return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, "0")}/km`;
}

/** Carte « Prédictions de course » : chronos réalistes estimés via VDOT. */
export default function RacePredictions() {
  const [pred, setPred] = useState<Predictions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRacePredictions()
      .then((p) => setPred(asPred(p)))
      .catch(() => setPred(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !pred) return null;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
          <ion-icon name="trophy-outline" className="text-base text-green-600"></ion-icon>
          Prédictions de course
        </h2>
        <span className="text-xs text-neutral-400">
          VDOT {pred.vdot} · {pred.source}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {pred.races.map((r) => (
          <div
            key={r.label}
            className="rounded-xl border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div className="text-xs text-neutral-400">{r.label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
              {fmtTime(r.time_s)}
            </div>
            <div className="text-xs text-neutral-400 tabular-nums">{fmtPace(r.pace_s_per_km)}</div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-neutral-400">
        Estimations dans des conditions idéales et avec l'entraînement spécifique adéquat. Utile
        pour fixer un objectif réaliste — demande au coach dans le chat pour bâtir le plan.
      </p>
    </section>
  );
}
