import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";
import CoachAnalysis from "../components/CoachAnalysis";
import CoachInsight from "../components/CoachInsight";
import MyZones from "../components/MyZones";
import Notes from "../components/Notes";
import ActivityLogModal, { type ActivityLog } from "../components/ActivityLogModal";
import Onboarding from "../components/Onboarding";
import { HrTrendChart, PaceTrendChart, VolumeChart } from "../components/Charts";
import type { Activity } from "../lib/types";
import { formatDuration, formatKm, formatPace, weekStart } from "../lib/format";

const RANGES = [
  { key: "day", label: "Jour", days: 30, bucket: "day" },
  { key: "week", label: "Semaine", days: 180, bucket: "week" },
  { key: "month", label: "Mois", days: 730, bucket: "month" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const prettySport = (s: string) => s.replaceAll("_", " ");

export default function Dashboard() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [vo2max, setVo2max] = useState<number | null>(null);
  const [vo2Source, setVo2Source] = useState<string | null>(null);
  const [restingHr, setRestingHr] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeKey, setRangeKey] = useState<RangeKey>("week");
  const [sport, setSport] = useState<string>("all");
  const [logs, setLogs] = useState<Record<string, ActivityLog>>({});
  const [logActivity, setLogActivity] = useState<Activity | null>(null);

  const range = RANGES.find((r) => r.key === rangeKey)!;

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data: acts, error: aErr } = await supabase
      .from("activities")
      .select(
        "id, garmin_activity_id, activity_type, start_time, distance_m, duration_s, avg_hr, avg_pace_s_per_km, training_load",
      )
      .order("start_time", { ascending: false })
      .limit(500);
    if (aErr) {
      setError(aErr.message);
      setLoading(false);
      return;
    }
    setActivities(acts ?? []);

    const { data: dm } = await supabase
      .from("daily_metrics")
      .select("vo2max, vo2max_source, resting_hr")
      .order("metric_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    setVo2max(dm?.vo2max ?? null);
    setVo2Source(dm?.vo2max_source ?? null);
    setRestingHr(dm?.resting_hr ?? null);

    const { data: lg } = await supabase
      .from("activity_logs")
      .select("id, activity_id, ressenti, fueled, intake, carbs_g, fluids_ml, calories");
    const map: Record<string, ActivityLog> = {};
    for (const l of lg ?? []) map[l.activity_id] = l as ActivityLog;
    setLogs(map);

    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const sports = useMemo(
    () =>
      Array.from(
        new Set(activities.map((a) => a.activity_type).filter(Boolean) as string[]),
      ).sort(),
    [activities],
  );

  // Activités filtrées : période (zoom) + sport.
  const filtered = useMemo(
    () =>
      activities.filter((a) => {
        if (!a.start_time) return false;
        if (Date.now() - new Date(a.start_time).getTime() > range.days * 86400000)
          return false;
        if (sport !== "all" && a.activity_type !== sport) return false;
        return true;
      }),
    [activities, range.days, sport],
  );

  const stats = useMemo(() => {
    const totalKm = filtered.reduce((s, a) => s + (a.distance_m ?? 0), 0) / 1000;
    const longest = filtered.reduce((m, a) => Math.max(m, a.distance_m ?? 0), 0);
    const runPaces = filtered
      .filter((a) => a.activity_type?.includes("running") && (a.avg_pace_s_per_km ?? 0) > 0)
      .map((a) => a.avg_pace_s_per_km as number);
    const bestPace = runPaces.length ? Math.min(...runPaces) : null;
    const byWeek = new Map<number, number>();
    for (const a of filtered) {
      if (!a.start_time || !a.distance_m) continue;
      const key = weekStart(new Date(a.start_time)).getTime();
      byWeek.set(key, (byWeek.get(key) ?? 0) + a.distance_m / 1000);
    }
    const bestWeek = byWeek.size ? Math.max(...byWeek.values()) : 0;
    return { totalKm, longest, bestPace, bestWeek };
  }, [filtered]);

  const selectCls =
    "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300";

  return (
    <Layout>
      <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Erreur : {error}
          </div>
        )}
        {loading && (
          <p className="flex items-center gap-2 text-sm text-neutral-500">
            <Spinner /> Chargement de tes données…
          </p>
        )}

        {/* Message proactif du coach */}
        <CoachInsight />

        {/* Barre d'outils : zoom timeline + tri par sport */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-700">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRangeKey(r.key)}
                className={`rounded-md px-3 py-1 text-sm transition ${
                  rangeKey === r.key
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className={selectCls}
            aria-label="Filtrer par sport"
          >
            <option value="all">Tous les sports</option>
            {sports.map((s) => (
              <option key={s} value={s}>
                {prettySport(s)}
              </option>
            ))}
          </select>
        </div>

        {/* Cartes d'information */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label={`Activités (${range.label})`} value={String(filtered.length)} />
          <Card label="Distance totale" value={formatKm(stats.totalKm * 1000)} />
          <Vo2Card value={vo2max} source={vo2Source} />
          <Card label="FC repos" value={restingHr ? `${restingHr} bpm` : "—"} />
        </section>

        {/* Records (sur la période) */}
        <section className="grid gap-4 sm:grid-cols-3">
          <Card label="Plus longue sortie" value={formatKm(stats.longest)} />
          <Card label="Meilleure allure (course)" value={formatPace(stats.bestPace)} />
          <Card
            label="Meilleure semaine"
            value={stats.bestWeek ? `${stats.bestWeek.toFixed(1)} km` : "—"}
          />
        </section>

        {/* Zones perso (FC & allure) */}
        <MyZones />

        {/* Coach IA */}
        <CoachAnalysis days={Math.min(range.days, 120)} />

        {/* Notes libres (alimentent le coach IA) */}
        <Notes />

        {/* Graphes */}
        <section className="grid gap-4 lg:grid-cols-2">
          <VolumeChart activities={filtered} bucket={range.bucket} />
          <PaceTrendChart activities={filtered} />
          <HrTrendChart activities={filtered} />
        </section>

        {/* Tableau des activités */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="font-medium text-neutral-900 dark:text-neutral-100">
            Activités récentes
          </h2>
          {filtered.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">
              Aucune activité sur cette période. Connecte/synchronise ton Garmin depuis
              ton Profil (icône en haut à droite).
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Distance</th>
                    <th className="py-2 pr-4">Durée</th>
                    <th className="py-2 pr-4">Allure</th>
                    <th className="py-2 pr-4">FC moy.</th>
                    <th className="py-2 text-right">Journal</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 25).map((a) => {
                    const hasLog = Boolean(logs[a.id]);
                    return (
                      <tr
                        key={a.id}
                        className="border-t border-neutral-100 dark:border-neutral-800"
                      >
                        <td className="py-2 pr-4">
                          {a.start_time
                            ? new Date(a.start_time).toLocaleDateString("fr-FR")
                            : "—"}
                        </td>
                        <td className="py-2 pr-4">
                          {a.activity_type ? prettySport(a.activity_type) : "—"}
                        </td>
                        <td className="py-2 pr-4">{formatKm(a.distance_m)}</td>
                        <td className="py-2 pr-4">{formatDuration(a.duration_s)}</td>
                        <td className="py-2 pr-4">
                          {a.activity_type?.includes("running")
                            ? formatPace(a.avg_pace_s_per_km)
                            : "—"}
                        </td>
                        <td className="py-2 pr-4">{a.avg_hr ?? "—"}</td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => setLogActivity(a)}
                            title={hasLog ? "Modifier le ressenti / ravitaillement" : "Ajouter ressenti / ravitaillement"}
                            className={`inline-flex items-center gap-1 text-xs ${hasLog ? "text-green-600" : "text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"}`}
                          >
                            <ion-icon name={hasLog ? "checkmark-circle-outline" : "add-circle-outline"}></ion-icon>
                            {hasLog ? "Noté" : "Noter"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {logActivity && (
        <ActivityLogModal
          activityId={logActivity.id}
          activityLabel={`${
            logActivity.start_time ? new Date(logActivity.start_time).toLocaleDateString("fr-FR") : ""
          } · ${logActivity.activity_type ? prettySport(logActivity.activity_type) : "activité"} · ${formatKm(logActivity.distance_m)}`}
          log={logs[logActivity.id] ?? null}
          onClose={() => setLogActivity(null)}
          onSaved={(l) => {
            const aid = logActivity.id;
            setLogs((m) => {
              const copy = { ...m };
              if (l) copy[aid] = l;
              else delete copy[aid];
              return copy;
            });
            setLogActivity(null);
          }}
        />
      )}

      <Onboarding />
    </Layout>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {value}
      </div>
    </div>
  );
}

/** Carte VO2max avec badge de provenance (Garmin / Estimé). */
function Vo2Card({ value, source }: { value: number | null; source: string | null }) {
  const badge =
    source === "garmin"
      ? { text: "Garmin", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" }
      : source === "calculated"
        ? { text: "Estimé", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" }
        : null;
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">VO₂ max</span>
        {badge && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
            {badge.text}
          </span>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {value ?? "—"}
      </div>
    </div>
  );
}
