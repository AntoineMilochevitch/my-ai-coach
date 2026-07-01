import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Row {
  day: string;
  kind: string;
  count: number;
  tokens_in: number | string;
  tokens_out: number | string;
}

const KIND_LABEL: Record<string, string> = {
  chat: "Chat",
  analyze: "Analyses",
  nutrition: "Nutrition",
  plan: "Plans",
  estimate: "Estimation repas",
  embed: "Indexation (RAG)",
};
const ORDER = ["chat", "plan", "analyze", "nutrition", "estimate", "embed"];

/** Consommation IA (requêtes + tokens) par type d'appel : aujourd'hui et 7 jours. */
export default function UsagePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("ai_usage")
        .select("day, kind, count, tokens_in, tokens_out")
        .gte("day", since);
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const agg = new Map<string, { todayCount: number; weekCount: number; tokens: number }>();
  for (const r of rows) {
    const e = agg.get(r.kind) ?? { todayCount: 0, weekCount: 0, tokens: 0 };
    e.weekCount += Number(r.count) || 0;
    e.tokens += (Number(r.tokens_in) || 0) + (Number(r.tokens_out) || 0);
    if (r.day === today) e.todayCount += Number(r.count) || 0;
    agg.set(r.kind, e);
  }
  const kinds = ORDER.filter((k) => agg.has(k)).concat(
    [...agg.keys()].filter((k) => !ORDER.includes(k)),
  );
  const totalToday = [...agg.values()].reduce((s, e) => s + e.todayCount, 0);
  const totalTokens = [...agg.values()].reduce((s, e) => s + e.tokens, 0);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
        <ion-icon name="stats-chart-outline" className="text-base"></ion-icon>
        Consommation IA
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Requêtes et tokens par type d'appel (jour UTC). Utile pour surveiller les quotas
        de ta clé.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-neutral-500">Chargement…</p>
      ) : kinds.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">Aucune consommation enregistrée.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4 text-right">Aujourd'hui</th>
                <th className="py-2 pr-4 text-right">7 jours</th>
                <th className="py-2 text-right">Tokens (7 j)</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => {
                const e = agg.get(k)!;
                return (
                  <tr key={k} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-2 pr-4 text-neutral-800 dark:text-neutral-200">
                      {KIND_LABEL[k] ?? k}
                    </td>
                    <td className="py-2 pr-4 text-right">{e.todayCount}</td>
                    <td className="py-2 pr-4 text-right">{e.weekCount}</td>
                    <td className="py-2 text-right">{e.tokens.toLocaleString("fr-FR")}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-neutral-200 font-medium dark:border-neutral-700">
                <td className="py-2 pr-4">Total</td>
                <td className="py-2 pr-4 text-right">{totalToday}</td>
                <td className="py-2 pr-4 text-right">
                  {[...agg.values()].reduce((s, e) => s + e.weekCount, 0)}
                </td>
                <td className="py-2 text-right">{totalTokens.toLocaleString("fr-FR")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
