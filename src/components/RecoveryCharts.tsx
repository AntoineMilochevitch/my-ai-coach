import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "../lib/supabase";

const GRID = "#94a3b833";
const axis = { stroke: "#94a3b8", fontSize: 11 };

interface Row {
  date: string;
  hrv?: number | null;
  resting?: number | null;
  readiness?: number | null;
  sleep_h?: number | null;
}
type Key = "hrv" | "resting" | "readiness" | "sleep_h";

const short = (d: string) => {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
};

function MetricChart({
  title,
  rows,
  dataKey,
  color,
  unit,
  domain,
  reversed,
}: {
  title: string;
  rows: Row[];
  dataKey: Key;
  color: string;
  unit: string;
  domain?: [string | number, string | number];
  reversed?: boolean;
}) {
  const count = rows.filter((r) => r[dataKey] != null).length;
  let latest: number | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][dataKey] != null) {
      latest = rows[i][dataKey] as number;
      break;
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{title}</h3>
        {latest != null && (
          <span className="text-sm font-semibold tabular-nums" style={{ color }}>
            {latest}
            <span className="ml-0.5 text-xs font-normal text-neutral-400">{unit}</span>
          </span>
        )}
      </div>
      {count < 2 ? (
        <p className="py-8 text-center text-xs text-neutral-400">Pas assez de données.</p>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={rows} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} minTickGap={24} {...axis} />
            <YAxis domain={domain ?? ["dataMin - 3", "dataMax + 3"]} reversed={reversed} {...axis} />
            <Tooltip
              labelFormatter={(l) => short(String(l))}
              formatter={(v) => [`${v} ${unit}`, title]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Graphes de récupération : HRV, readiness, FC repos, sommeil sur ~45 jours. */
export default function RecoveryCharts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      const [dmRes, slRes] = await Promise.all([
        supabase
          .from("daily_metrics")
          .select("metric_date, hrv_avg, resting_hr, training_readiness")
          .gte("metric_date", since)
          .order("metric_date", { ascending: true }),
        supabase
          .from("sleep")
          .select("sleep_date, total_s")
          .gte("sleep_date", since)
          .order("sleep_date", { ascending: true }),
      ]);
      const map = new Map<string, Row>();
      for (const r of dmRes.data ?? [])
        map.set(r.metric_date, {
          date: r.metric_date,
          hrv: r.hrv_avg,
          resting: r.resting_hr,
          readiness: r.training_readiness,
        });
      for (const s of slRes.data ?? []) {
        const e: Row = map.get(s.sleep_date) ?? { date: s.sleep_date };
        e.sleep_h = s.total_s ? +(s.total_s / 3600).toFixed(1) : null;
        map.set(s.sleep_date, e);
      }
      setRows([...map.values()].sort((a, b) => a.date.localeCompare(b.date)));
      setLoading(false);
    })();
  }, []);

  if (loading || rows.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
        <ion-icon name="heart-half-outline" className="text-base text-green-600"></ion-icon>
        Récupération
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricChart title="HRV (VFC)" rows={rows} dataKey="hrv" color="#34d399" unit="ms" />
        <MetricChart
          title="Readiness"
          rows={rows}
          dataKey="readiness"
          color="#a78bfa"
          unit="/100"
          domain={[0, 100]}
        />
        <MetricChart
          title="FC de repos"
          rows={rows}
          dataKey="resting"
          color="#f87171"
          unit="bpm"
        />
        <MetricChart
          title="Sommeil"
          rows={rows}
          dataKey="sleep_h"
          color="#38bdf8"
          unit="h"
          domain={["dataMin - 1", "dataMax + 1"]}
        />
      </div>
    </section>
  );
}
