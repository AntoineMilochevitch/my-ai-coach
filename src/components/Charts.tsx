import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Activity } from "../lib/types";
import { formatPace, paceMinPerKm, shortDate, weekStart } from "../lib/format";

const ACCENT = "#38bdf8";
const GRID = "#94a3b833";

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="py-8 text-center text-sm text-neutral-400">Pas assez de données.</p>;
}

const axis = { stroke: "#94a3b8", fontSize: 12 };

export type Bucket = "day" | "week" | "month";

const BUCKET_TITLE: Record<Bucket, string> = {
  day: "Volume quotidien (km)",
  week: "Volume hebdomadaire (km)",
  month: "Volume mensuel (km)",
};

/** Volume agrégé (km) — barres, granularité jour/semaine/mois. */
export function VolumeChart({
  activities,
  bucket,
}: {
  activities: Activity[];
  bucket: Bucket;
}) {
  const map = new Map<string, { sort: number; label: string; km: number }>();
  for (const a of activities) {
    if (!a.start_time || !a.distance_m) continue;
    const d = new Date(a.start_time);
    let key: string;
    let sort: number;
    let label: string;
    if (bucket === "day") {
      key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      sort = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      label = shortDate(d);
    } else if (bucket === "week") {
      const ws = weekStart(d);
      key = String(ws.getTime());
      sort = ws.getTime();
      label = shortDate(ws);
    } else {
      key = `${d.getFullYear()}-${d.getMonth()}`;
      sort = d.getFullYear() * 12 + d.getMonth();
      label = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
    }
    const entry = map.get(key) ?? { sort, label, km: 0 };
    entry.km += a.distance_m / 1000;
    map.set(key, entry);
  }
  const data = [...map.values()]
    .sort((a, b) => a.sort - b.sort)
    .map((v) => ({ label: v.label, km: +v.km.toFixed(1) }));

  return (
    <ChartCard title={BUCKET_TITLE[bucket]}>
      {data.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} />
            <Tooltip
              formatter={(v) => [`${v} km`, "Volume"]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="km" fill={ACCENT} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

/** Tendance d'allure (course uniquement) — ligne, min/km. */
export function PaceTrendChart({ activities }: { activities: Activity[] }) {
  const data = activities
    .filter((a) => a.activity_type?.includes("running") && a.start_time)
    .map((a) => ({
      date: shortDate(new Date(a.start_time!)),
      t: new Date(a.start_time!).getTime(),
      pace: paceMinPerKm(a.avg_pace_s_per_km),
    }))
    .filter((d) => d.pace !== null)
    .sort((a, b) => a.t - b.t);

  return (
    <ChartCard title="Allure course (min/km)">
      {data.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" {...axis} />
            <YAxis {...axis} domain={["dataMin - 0.3", "dataMax + 0.3"]} reversed />
            <Tooltip
              formatter={(v) => [formatPace(Number(v) * 60), "Allure"]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Line type="monotone" dataKey="pace" stroke={ACCENT} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

/** Tendance FC moyenne — ligne, bpm. */
export function HrTrendChart({ activities }: { activities: Activity[] }) {
  const data = activities
    .filter((a) => a.avg_hr && a.start_time)
    .map((a) => ({
      date: shortDate(new Date(a.start_time!)),
      t: new Date(a.start_time!).getTime(),
      hr: a.avg_hr,
    }))
    .sort((a, b) => a.t - b.t);

  return (
    <ChartCard title="FC moyenne par séance (bpm)">
      {data.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" {...axis} />
            <YAxis {...axis} domain={["dataMin - 5", "dataMax + 5"]} />
            <Tooltip
              formatter={(v) => [`${v} bpm`, "FC moy."]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Line type="monotone" dataKey="hr" stroke="#f87171" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
