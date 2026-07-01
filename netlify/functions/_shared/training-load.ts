/**
 * Détection de surcharge — ratio charge aiguë / charge chronique (ACWR).
 *
 *  - Charge aiguë   = somme de la charge (training_load) des 7 derniers jours.
 *  - Charge chronique = moyenne hebdomadaire sur 28 jours = (somme 28 j) / 4.
 *  - ACWR = aiguë / chronique. Zone "optimale" ~0.8–1.3 ; >1.5 = risque de blessure ;
 *    <0.8 = sous-charge / désentraînement.
 *
 * Sert d'alerte au coach proactif ET d'affichage (endpoint training-load).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type LoadStatus = "detraining" | "optimal" | "high" | "very_high";

export interface LoadBalance {
  acute_7d: number; // charge des 7 derniers jours
  chronic_weekly: number; // charge hebdo moyenne sur 28 j
  acwr: number | null; // ratio aiguë/chronique
  status: LoadStatus | null;
  weekly: { start: string; load: number }[]; // 6 fenêtres de 7 j, de la plus ancienne à la plus récente
  trend_pct: number | null; // variation semaine courante vs précédente (%)
}

function statusOf(acwr: number | null): LoadStatus | null {
  if (acwr == null) return null;
  if (acwr < 0.8) return "detraining";
  if (acwr <= 1.3) return "optimal";
  if (acwr <= 1.5) return "high";
  return "very_high";
}

const WEEKS = 6;

/** Calcul PUR de l'équilibre de charge (testable sans base). `now` = ms epoch. */
export function computeLoadBalance(
  acts: { start_time: string | null; training_load: number | null }[],
  now: number,
): LoadBalance | null {
  // Fenêtres roulantes de 7 j : index 0 = plus ancienne … WEEKS-1 = semaine courante.
  const buckets = new Array(WEEKS).fill(0) as number[];
  for (const a of acts) {
    if (!a.start_time) continue;
    const t = new Date(a.start_time).getTime();
    if (Number.isNaN(t)) continue;
    const ageDays = (now - t) / 86400000;
    if (ageDays < 0 || ageDays >= WEEKS * 7) continue;
    const idx = WEEKS - 1 - Math.floor(ageDays / 7);
    if (idx >= 0 && idx < WEEKS) buckets[idx] += Number(a.training_load) || 0;
  }

  const totalLoad = buckets.reduce((s, x) => s + x, 0);
  if (totalLoad <= 0) return null;

  const acute = buckets[WEEKS - 1];
  const last4 = buckets.slice(WEEKS - 4); // 28 derniers jours
  const chronicWeekly = last4.reduce((s, x) => s + x, 0) / 4;
  const acwr = chronicWeekly > 0 ? acute / chronicWeekly : null;

  const prev = buckets[WEEKS - 2];
  const trendPct = prev > 0 ? Math.round(((acute - prev) / prev) * 100) : null;

  const weekly = buckets.map((load, i) => ({
    start: new Date(now - (WEEKS - i) * 7 * 86400000).toISOString().slice(0, 10),
    load: Math.round(load),
  }));

  return {
    acute_7d: Math.round(acute),
    chronic_weekly: Math.round(chronicWeekly),
    acwr: acwr != null ? Math.round(acwr * 100) / 100 : null,
    status: statusOf(acwr),
    weekly,
    trend_pct: trendPct,
  };
}

export async function trainingLoad(sb: SupabaseClient, userId: string): Promise<LoadBalance | null> {
  const since = new Date(Date.now() - WEEKS * 7 * 86400000).toISOString();
  const { data } = await sb
    .from("activities")
    .select("start_time, training_load")
    .eq("user_id", userId)
    .gte("start_time", since)
    .not("training_load", "is", null);

  return computeLoadBalance(data ?? [], Date.now());
}

/** Ligne texte compacte pour le contexte IA. "" si non calculable. */
export function loadText(b: LoadBalance | null): string {
  if (!b || b.acwr == null) return "";
  const label: Record<LoadStatus, string> = {
    detraining: "sous-charge (désentraînement possible)",
    optimal: "optimale",
    high: "élevée (prudence)",
    very_high: "très élevée (risque de blessure)",
  };
  const s = b.status ? label[b.status] : "";
  return `Charge : ACWR ${b.acwr} (aiguë 7 j ${b.acute_7d} vs chronique hebdo ${b.chronic_weekly}) → zone ${s}${
    b.trend_pct != null ? `, ${b.trend_pct >= 0 ? "+" : ""}${b.trend_pct}% vs semaine précédente` : ""
  }`;
}
