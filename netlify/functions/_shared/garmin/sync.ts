/**
 * Synchronisation Garmin -> Supabase.
 *
 * Contraintes serverless (timeout ~10 s sur Netlify) :
 *  - les appels par jour (résumé, sommeil) sont parallélisés avec une concurrence
 *    limitée pour rester rapides sans déclencher de 429 ;
 *  - fenêtres volontairement courtes par défaut (activités 30 j, quotidien 7 j) ;
 *    l'historique long sera couvert par une synchro paginée/planifiée plus tard.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  connectApi,
  refreshTokens,
  tokenExpiresSoon,
  type GarminTokens,
} from "./auth.ts";
import { mapLimit } from "../concurrency.ts";

export interface SyncOptions {
  activityDays?: number;
  dailyDays?: number;
}

export interface SyncResult {
  tokens: GarminTokens;
  refreshed: boolean;
  displayName: string | null;
  counts: { activities: number; dailyMetrics: number; sleep: number };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastNDates(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    out.push(isoDate(d));
  }
  return out;
}

function num(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/**
 * Estime le VO2max à partir de la MEILLEURE course récente (formule de Daniels :
 * VDOT). Utilisé quand la montre ne fournit pas de VO2max. Approximation : prend
 * le max sur les courses (les sorties faciles sous-estiment).
 */
function estimateVo2max(activities: any[]): number | null {
  let best = 0;
  for (const a of activities) {
    if (!a.activity_type?.includes("running")) continue;
    const dist = a.distance_m;
    const dur = a.duration_s;
    if (!dist || !dur || dist < 1500 || dur < 300) continue; // course réelle
    const tMin = dur / 60;
    const v = dist / tMin; // m/min
    const pctMax =
      0.8 +
      0.1894393 * Math.exp(-0.012778 * tMin) +
      0.2989558 * Math.exp(-0.1932605 * tMin);
    const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
    const vo2max = vo2 / pctMax;
    if (vo2max > best) best = vo2max;
  }
  return best > 0 ? Math.round(best * 10) / 10 : null;
}

export async function syncGarmin(
  sb: SupabaseClient,
  userId: string,
  tokens: GarminTokens,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const activityDays = opts.activityDays ?? 365;
  const dailyDays = opts.dailyDays ?? 7;

  // Rafraîchit une fois en amont si nécessaire (la fenêtre de sync est courte).
  let refreshed = false;
  if (tokenExpiresSoon(tokens.accessToken)) {
    tokens = await refreshTokens(tokens);
    refreshed = true;
  }
  const token = tokens.accessToken;

  // Nom d'affichage (UUID) requis par certains endpoints.
  const profile = await connectApi<any>(token, "/userprofile-service/socialProfile");
  const displayName: string | null = profile?.displayName ?? null;

  const counts = { activities: 0, dailyMetrics: 0, sleep: 0 };

  // --- Activités (un endpoint paginé sur la plage de dates) ---
  const today = new Date();
  const startActivities = new Date(today);
  startActivities.setUTCDate(today.getUTCDate() - activityDays);
  const actRows: any[] = [];
  let start = 0;
  const limit = 20;
  for (let page = 0; page < 15; page++) {
    const qs = new URLSearchParams({
      startDate: isoDate(startActivities),
      endDate: isoDate(today),
      start: String(start),
      limit: String(limit),
    });
    const batch = await connectApi<any[]>(
      token,
      `/activitylist-service/activities/search/activities?${qs}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const a of batch) {
      const distance = num(a.distance);
      const duration = num(a.duration);
      actRows.push({
        user_id: userId,
        garmin_activity_id: a.activityId,
        activity_type: a.activityType?.typeKey ?? null,
        start_time: a.startTimeGMT ? `${a.startTimeGMT}Z`.replace(" ", "T") : null,
        distance_m: distance,
        duration_s: duration,
        avg_hr: num(a.averageHR),
        max_hr: num(a.maxHR),
        avg_pace_s_per_km:
          distance && distance > 0 && duration ? duration / (distance / 1000) : null,
        elevation_gain_m: num(a.elevationGain),
        calories: num(a.calories),
        aerobic_te: num(a.aerobicTrainingEffect),
        anaerobic_te: num(a.anaerobicTrainingEffect),
        training_load: num(a.activityTrainingLoad),
        vo2max: num(a.vO2MaxValue),
        raw: a,
      });
    }
    start += limit;
  }
  if (actRows.length) {
    const { error } = await sb
      .from("activities")
      .upsert(actRows, { onConflict: "user_id,garmin_activity_id" });
    if (error) throw new Error(`upsert activities: ${error.message}`);
    counts.activities = actRows.length;
  }

  // --- Métriques quotidiennes + sommeil ---
  const dates = lastNDates(dailyDays);
  const cdate = dates[0];

  // VO2max : valeur Garmin la plus récente sur 30 j ; à défaut, estimation Daniels.
  const vo2Start = isoDate(new Date(Date.now() - 30 * 86400000));
  const [maxmet, readiness] = await Promise.all([
    connectApi<any[]>(
      token,
      `/metrics-service/metrics/maxmet/daily/${vo2Start}/${cdate}`,
    ).catch(() => null),
    connectApi<any[]>(
      token,
      `/metrics-service/metrics/trainingreadiness/${cdate}`,
    ).catch(() => null),
  ]);

  let vo2max: number | null = null;
  let vo2Source: "garmin" | "calculated" | null = null;
  let vo2Date = "";
  if (Array.isArray(maxmet)) {
    for (const e of maxmet) {
      const val = e?.generic?.vo2MaxPreciseValue ?? e?.generic?.vo2MaxValue ?? null;
      const date = e?.calendarDate ?? e?.generic?.calendarDate ?? "";
      if (val && (!vo2Date || date >= vo2Date)) {
        vo2max = num(val);
        vo2Date = date;
      }
    }
  }
  if (vo2max) {
    vo2Source = "garmin";
  } else {
    const est = estimateVo2max(actRows);
    if (est) {
      vo2max = est;
      vo2Source = "calculated";
    }
  }
  const readinessScore = (Array.isArray(readiness) && readiness[0]?.score) ?? null;

  // Une ligne par date avec un jeu de colonnes UNIFORME (évite que l'upsert par
  // lot écrase des colonnes). On ne garde que les jours porteurs de données.
  const blank = (d: string) => ({
    user_id: userId,
    metric_date: d,
    resting_hr: null as number | null,
    stress_avg: null as number | null,
    body_battery_min: null as number | null,
    body_battery_max: null as number | null,
    vo2max: null as number | null,
    vo2max_source: null as string | null,
    training_readiness: null as number | null,
    raw: null as any,
  });
  const metricByDate = new Map<string, ReturnType<typeof blank>>();
  for (const d of dates) metricByDate.set(d, blank(d));

  const sleepRows: any[] = [];
  await mapLimit(dates, 5, async (d) => {
    const [summary, sleep] = await Promise.all([
      connectApi<any>(
        token,
        `/usersummary-service/usersummary/daily/${displayName}?calendarDate=${d}`,
      ).catch(() => null),
      connectApi<any>(
        token,
        `/wellness-service/wellness/dailySleepData/${displayName}?date=${d}&nonSleepBufferMinutes=60`,
      ).catch(() => null),
    ]);

    const row = metricByDate.get(d)!;
    if (summary && typeof summary === "object") {
      row.resting_hr = num(summary.restingHeartRate);
      row.stress_avg = num(summary.averageStressLevel);
      row.body_battery_min = num(summary.bodyBatteryLowestValue);
      row.body_battery_max = num(summary.bodyBatteryHighestValue);
      row.raw = summary;
    }

    const dto = sleep?.dailySleepDTO;
    if (dto && typeof dto === "object") {
      sleepRows.push({
        user_id: userId,
        sleep_date: d,
        total_s: num(dto.sleepTimeSeconds),
        deep_s: num(dto.deepSleepSeconds),
        rem_s: num(dto.remSleepSeconds),
        light_s: num(dto.lightSleepSeconds),
        awake_s: num(dto.awakeSleepSeconds),
        score: num(dto.sleepScores?.overall?.value),
        raw: sleep,
      });
    }
  });

  // VO2max + readiness portés par la ligne du jour.
  const todayRow = metricByDate.get(cdate)!;
  todayRow.vo2max = vo2max;
  todayRow.vo2max_source = vo2Source;
  todayRow.training_readiness = readinessScore;

  // On n'upsert que les jours avec données (le jour courant est toujours gardé).
  const metricRows = [...metricByDate.values()].filter(
    (r) =>
      r.metric_date === cdate ||
      r.resting_hr != null ||
      r.stress_avg != null ||
      r.body_battery_min != null ||
      r.body_battery_max != null,
  );
  if (metricRows.length) {
    const { error } = await sb
      .from("daily_metrics")
      .upsert(metricRows, { onConflict: "user_id,metric_date" });
    if (error) throw new Error(`upsert daily_metrics: ${error.message}`);
    counts.dailyMetrics = metricRows.length;
  }
  if (sleepRows.length) {
    const { error } = await sb
      .from("sleep")
      .upsert(sleepRows, { onConflict: "user_id,sleep_date" });
    if (error) throw new Error(`upsert sleep: ${error.message}`);
    counts.sleep = sleepRows.length;
  }

  return { tokens, refreshed, displayName, counts };
}
