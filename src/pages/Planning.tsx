import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";
import StepsList, { type Step } from "../components/StepsList";
import { matchPlan, pushWorkout } from "../lib/api";

interface Workout {
  id: string;
  scheduled_date: string;
  sport: string | null;
  title: string | null;
  description: string | null;
  session_type: string | null;
  status: string;
  garmin_workout_id: number | null;
  target: {
    distance_km?: number | null;
    duree_min?: number | null;
    allure?: string | null;
    zone_fc?: string | null;
  } | null;
  steps: Step[] | null;
}

const TYPE_COLOR: Record<string, string> = {
  easy: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  recovery: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  long: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  tempo: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  interval: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  cross: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  strength: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};
const RUN_TYPES = ["easy", "long", "tempo", "interval", "recovery"];
function isRunSession(w: { sport: string | null; session_type: string | null }): boolean {
  const s = (w.sport ?? "").toLowerCase();
  if (s.includes("run") || s.includes("cours")) return true;
  return RUN_TYPES.includes((w.session_type ?? "").toLowerCase());
}

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function targetLine(t: Workout["target"]): string {
  if (!t) return "";
  return [
    t.distance_km ? `${Math.round(t.distance_km * 10) / 10} km` : "",
    t.duree_min ? `${Math.round(t.duree_min)} min` : "",
    t.allure ? `allure ${t.allure}` : "",
    t.zone_fc ? `FC ${t.zone_fc}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function Planning() {
  const [plan, setPlan] = useState<{ id: string; goal: string | null } | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"week" | "month">("month");
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selected, setSelected] = useState<Workout | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: p } = await supabase
      .from("training_plans")
      .select("id, goal, status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!p || p.status !== "active") {
      setPlan(null);
      setWorkouts([]);
      setLoading(false);
      return;
    }
    setPlan({ id: p.id, goal: p.goal });
    await matchPlan().catch(() => {});
    const { data: w } = await supabase
      .from("plan_workouts")
      .select(
        "id, scheduled_date, sport, title, description, session_type, status, garmin_workout_id, target, steps",
      )
      .eq("plan_id", p.id)
      .order("scheduled_date", { ascending: true });
    setWorkouts(w ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => {
    let start: Date;
    let count: number;
    if (view === "week") {
      start = mondayOf(cursor);
      count = 7;
    } else {
      start = mondayOf(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      const endMon = mondayOf(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
      count = Math.round((endMon.getTime() - start.getTime()) / 86400000) + 7;
    }
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }, [view, cursor]);

  const byDate = useMemo(() => {
    const map = new Map<string, Workout[]>();
    for (const w of workouts) {
      const arr = map.get(w.scheduled_date) ?? map.set(w.scheduled_date, []).get(w.scheduled_date)!;
      arr.push(w);
    }
    return map;
  }, [workouts]);

  const shift = (dir: number) => {
    setCursor((c) => {
      const d = new Date(c);
      if (view === "week") d.setDate(d.getDate() + 7 * dir);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  const periodLabel =
    view === "week"
      ? `Semaine du ${mondayOf(cursor).toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })}`
      : cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  async function toggleDone(w: Workout) {
    const next = w.status === "done" ? "planned" : "done";
    setWorkouts((ws) => ws.map((x) => (x.id === w.id ? { ...x, status: next } : x)));
    setSelected((s) => (s && s.id === w.id ? { ...s, status: next } : s));
    await supabase.from("plan_workouts").update({ status: next }).eq("id", w.id);
  }

  async function pushOne(w: Workout) {
    setInfo(null);
    setError(null);
    try {
      const res = await pushWorkout({ planWorkoutId: w.id });
      if (res.pushed) {
        setWorkouts((ws) => ws.map((x) => (x.id === w.id ? { ...x, garmin_workout_id: 1 } : x)));
        setSelected((s) => (s && s.id === w.id ? { ...s, garmin_workout_id: 1 } : s));
        setInfo("Séance envoyée sur Garmin.");
      } else {
        setError(res.errors[0] || "Échec de l'envoi.");
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const todayKey = ymd(new Date());
  const cellMin = view === "week" ? "min-h-40" : "min-h-24";
  const ghostBtn =
    "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <Layout>
      <main className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Planning</h1>
          <div className="inline-flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-700">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-sm ${view === v ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 dark:text-neutral-300"}`}
              >
                {v === "week" ? "Semaine" : "Mois"}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        {info && <p className="text-sm text-green-600">{info}</p>}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-neutral-500">
            <Spinner /> Chargement…
          </p>
        ) : !plan ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
            Aucun plan actif.{" "}
            <Link to="/plan" className="underline">
              Génère un plan d'entraînement
            </Link>{" "}
            pour voir ton calendrier.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <button onClick={() => shift(-1)} className={ghostBtn} aria-label="Précédent">
                <ion-icon name="chevron-back-outline"></ion-icon>
              </button>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize text-neutral-700 dark:text-neutral-300">
                  {periodLabel}
                </span>
                <button
                  onClick={() => {
                    const d = new Date();
                    d.setHours(0, 0, 0, 0);
                    setCursor(d);
                  }}
                  className="text-xs text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  aujourd'hui
                </button>
              </div>
              <button onClick={() => shift(1)} className={ghostBtn} aria-label="Suivant">
                <ion-icon name="chevron-forward-outline"></ion-icon>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-neutral-500">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => {
                const key = ymd(d);
                const items = byDate.get(key) ?? [];
                const inMonth = view === "week" || d.getMonth() === cursor.getMonth();
                const isToday = key === todayKey;
                return (
                  <div
                    key={key}
                    className={`${cellMin} rounded-lg border p-1.5 ${
                      isToday
                        ? "border-neutral-900 ring-1 ring-neutral-900 dark:border-neutral-100 dark:ring-neutral-100"
                        : "border-neutral-200 dark:border-neutral-800"
                    } ${inMonth ? "bg-white dark:bg-neutral-900" : "bg-neutral-50 opacity-50 dark:bg-neutral-950"}`}
                  >
                    <div className="text-right text-xs text-neutral-400">{d.getDate()}</div>
                    <div className="mt-1 space-y-1">
                      {items.map((w) => (
                        <button
                          key={w.id}
                          onClick={() => setSelected(w)}
                          title={w.title ?? ""}
                          className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] ${
                            TYPE_COLOR[w.session_type ?? ""] ??
                            "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          } ${w.status === "done" ? "line-through opacity-60" : ""} ${w.status === "missed" ? "opacity-60" : ""}`}
                        >
                          {w.title || w.session_type}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Modale détail de séance */}
      {selected && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 dark:bg-neutral-900 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      TYPE_COLOR[selected.session_type ?? ""] ??
                      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    }`}
                  >
                    {selected.session_type}
                  </span>
                  {selected.status === "done" && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700 dark:bg-green-900/40 dark:text-green-300">
                      faite
                    </span>
                  )}
                  {selected.status === "missed" && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      manquée
                    </span>
                  )}
                </div>
                <h2 className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {selected.title}
                </h2>
                <p className="text-xs text-neutral-500">
                  {new Date(selected.scheduled_date).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                  })}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                aria-label="Fermer"
              >
                <ion-icon name="close-outline" className="text-xl"></ion-icon>
              </button>
            </div>

            {targetLine(selected.target) && (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
                {targetLine(selected.target)}
              </p>
            )}
            {selected.description && (
              <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
                {selected.description}
              </p>
            )}
            {selected.steps && selected.steps.length > 0 && <StepsList steps={selected.steps} />}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                onClick={() => toggleDone(selected)}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                {selected.status === "done" ? "Marquer non faite" : "Marquer faite"}
              </button>
              {isRunSession(selected) &&
                (selected.garmin_workout_id ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600">
                    <ion-icon name="checkmark-circle-outline"></ion-icon> Sur Garmin
                  </span>
                ) : (
                  <button onClick={() => pushOne(selected)} className={ghostBtn}>
                    <ion-icon name="watch-outline" className="align-[-2px]"></ion-icon> Envoyer sur Garmin
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
