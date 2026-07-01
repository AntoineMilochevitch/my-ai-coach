import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import ActivityLogModal, { type ActivityLog } from "../components/ActivityLogModal";
import { supabase } from "../lib/supabase";
import { formatKm, formatDuration, formatPace } from "../lib/format";

interface FullActivity {
  id: string;
  activity_type: string | null;
  start_time: string | null;
  distance_m: number | null;
  duration_s: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_pace_s_per_km: number | null;
  elevation_gain_m: number | null;
  calories: number | null;
  aerobic_te: number | null;
  anaerobic_te: number | null;
  training_load: number | null;
  vo2max: number | null;
  raw: any;
}

const prettySport = (s: string | null) => (s ? s.replaceAll("_", " ") : "Activité");

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
        {value}
      </div>
    </div>
  );
}

/** Détails supplémentaires lus dans le payload Garmin brut (best-effort). */
function extraDetails(raw: any): { label: string; value: string }[] {
  if (!raw || typeof raw !== "object") return [];
  const out: { label: string; value: string }[] = [];
  const push = (v: unknown, label: string, fmt: (n: number) => string) => {
    const n = typeof v === "number" ? v : null;
    if (n != null && Number.isFinite(n)) out.push({ label, value: fmt(n) });
  };
  const pace = (mps: number) => (mps > 0 ? formatPace(1000 / mps) : "—");
  push(raw.averageSpeed, "Vitesse moy.", pace);
  push(raw.maxSpeed, "Vitesse max", pace);
  push(
    raw.averageRunningCadenceInStepsPerMinute,
    "Cadence moy.",
    (n) => `${Math.round(n)} ppm`,
  );
  push(raw.maxRunningCadenceInStepsPerMinute, "Cadence max", (n) => `${Math.round(n)} ppm`);
  push(raw.avgStrideLength, "Longueur de foulée", (n) => `${Math.round(n)} cm`);
  push(raw.avgPower, "Puissance moy.", (n) => `${Math.round(n)} W`);
  push(raw.maxPower, "Puissance max", (n) => `${Math.round(n)} W`);
  push(raw.avgGroundContactTime, "Contact au sol", (n) => `${Math.round(n)} ms`);
  push(raw.avgVerticalOscillation, "Oscillation vert.", (n) => `${n.toFixed(1)} cm`);
  push(raw.minElevation, "Altitude min", (n) => `${Math.round(n)} m`);
  push(raw.maxElevation, "Altitude max", (n) => `${Math.round(n)} m`);
  push(raw.steps, "Pas", (n) => `${Math.round(n)}`);
  push(raw.minTemperature, "Temp. min", (n) => `${Math.round(n)} °C`);
  push(raw.maxTemperature, "Temp. max", (n) => `${Math.round(n)} °C`);
  push(raw.waterEstimated, "Hydratation estimée", (n) => `${Math.round(n)} ml`);
  return out;
}

export default function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const [act, setAct] = useState<FullActivity | null>(null);
  const [log, setLog] = useState<ActivityLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [aRes, lRes] = await Promise.all([
        supabase
          .from("activities")
          .select(
            "id, activity_type, start_time, distance_m, duration_s, avg_hr, max_hr, avg_pace_s_per_km, elevation_gain_m, calories, aerobic_te, anaerobic_te, training_load, vo2max, raw",
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("activity_logs")
          .select("id, activity_id, ressenti, fueled, intake, carbs_g, fluids_ml, calories")
          .eq("activity_id", id)
          .maybeSingle(),
      ]);
      setAct((aRes.data as FullActivity) ?? null);
      setLog((lRes.data as ActivityLog) ?? null);
      setLoading(false);
    })();
  }, [id]);

  const isRun = act?.activity_type?.includes("running");
  const start = act?.start_time ? new Date(act.start_time) : null;
  const label = `${prettySport(act?.activity_type ?? null)}${
    start ? ` · ${start.toLocaleDateString("fr-FR")}` : ""
  }`;

  const stats: { label: string; value: string }[] = act
    ? [
        { label: "Distance", value: formatKm(act.distance_m) },
        { label: "Durée", value: formatDuration(act.duration_s) },
        ...(isRun ? [{ label: "Allure moy.", value: formatPace(act.avg_pace_s_per_km) }] : []),
        ...(act.avg_hr != null ? [{ label: "FC moyenne", value: `${act.avg_hr} bpm` }] : []),
        ...(act.max_hr != null ? [{ label: "FC max", value: `${act.max_hr} bpm` }] : []),
        ...(act.elevation_gain_m != null
          ? [{ label: "Dénivelé +", value: `${Math.round(act.elevation_gain_m)} m` }]
          : []),
        ...(act.calories != null ? [{ label: "Calories", value: `${Math.round(act.calories)} kcal` }] : []),
        ...(act.aerobic_te != null ? [{ label: "Effet aérobie", value: act.aerobic_te.toFixed(1) }] : []),
        ...(act.anaerobic_te != null
          ? [{ label: "Effet anaérobie", value: act.anaerobic_te.toFixed(1) }]
          : []),
        ...(act.training_load != null
          ? [{ label: "Charge", value: `${Math.round(act.training_load)}` }]
          : []),
        ...(act.vo2max != null ? [{ label: "VO₂max", value: `${Math.round(act.vo2max)}` }] : []),
      ]
    : [];

  const extras = act ? extraDetails(act.raw) : [];

  return (
    <Layout>
      <main className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          <ion-icon name="arrow-back-outline"></ion-icon>
          Retour
        </Link>

        {loading ? (
          <p className="text-sm text-neutral-500">Chargement…</p>
        ) : !act ? (
          <p className="text-sm text-neutral-500">Activité introuvable.</p>
        ) : (
          <>
            <header>
              <h1 className="text-xl font-semibold capitalize text-neutral-900 dark:text-neutral-100">
                {prettySport(act.activity_type)}
              </h1>
              <p className="text-sm text-neutral-500">
                {start
                  ? `${start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} à ${start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
                  : "—"}
              </p>
            </header>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {stats.map((s) => (
                <StatBox key={s.label} label={s.label} value={s.value} />
              ))}
            </section>

            {extras.length > 0 && (
              <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="mb-3 font-medium text-neutral-900 dark:text-neutral-100">Détails</h2>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                  {extras.map((e) => (
                    <div key={e.label} className="flex justify-between text-sm">
                      <span className="text-neutral-500">{e.label}</span>
                      <span className="font-medium tabular-nums text-neutral-800 dark:text-neutral-200">
                        {e.value}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Journal ressenti / ravitaillement */}
            <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <h2 className="font-medium text-neutral-900 dark:text-neutral-100">
                  Ressenti & ravitaillement
                </h2>
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 text-sm text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  <ion-icon name={log ? "create-outline" : "add-circle-outline"}></ion-icon>
                  {log ? "Modifier" : "Ajouter"}
                </button>
              </div>
              {log ? (
                <div className="mt-3 space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
                  {log.ressenti && <p className="whitespace-pre-wrap">{log.ressenti}</p>}
                  {log.fueled ? (
                    <p className="text-neutral-500">
                      Ravitaillement : {log.intake || "oui"}
                      {log.carbs_g != null ? ` · ${log.carbs_g} g glucides` : ""}
                      {log.fluids_ml != null ? ` · ${log.fluids_ml} ml` : ""}
                      {log.calories != null ? ` · ${log.calories} kcal` : ""}
                    </p>
                  ) : (
                    <p className="text-neutral-400">Pas de ravitaillement noté.</p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-neutral-500">
                  Aucun ressenti noté pour cette séance.
                </p>
              )}
            </section>
          </>
        )}
      </main>

      {editing && act && (
        <ActivityLogModal
          activityId={act.id}
          activityLabel={label}
          log={log}
          onClose={() => setEditing(false)}
          onSaved={(l) => {
            setLog(l);
            setEditing(false);
          }}
        />
      )}
    </Layout>
  );
}
