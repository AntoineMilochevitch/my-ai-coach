/**
 * Contexte enrichi de l'athlète pour la génération ET l'adaptation du plan :
 *  - performances récentes (activités) ;
 *  - récupération (HRV, readiness, FC repos, sommeil, charge) ;
 *  - nutrition agrégée ;
 *  - notes / ressenti ;
 *  - réalisé vs cible des séances du plan (allures tenues, séances faites/ratées).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPhysio, type Physio } from "./physio.ts";
import { athleteZones, type Zones } from "./zones.ts";
import { trainingLoad, type LoadBalance } from "./training-load.ts";
import { loadMemory, type MemoryItem } from "./memory.ts";

function fmtPace(sPerKm: number | null | undefined): string | null {
  if (!sPerKm || sPerKm <= 0) return null;
  return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, "0")}/km`;
}

export interface AthleteContext {
  profil: Physio | null;
  zones: Zones | null;
  charge: LoadBalance | null;
  memoire: MemoryItem[];
  activites_recentes: any[];
  recuperation: {
    indicateurs_recents: any[];
    sommeil_moy_7j_h: number | null;
    charge_7j: number | null;
  };
  nutrition_14j:
    | { jours_avec_donnees: number; kcal_moy: number; prot_moy: number; gluc_moy: number }
    | null;
  notes: { date: string; texte: string }[];
  realise_vs_cible: any[] | null;
  realise_compteur: { done: number; missed: number; planned: number } | null;
}

export async function buildAthleteContext(
  sb: SupabaseClient,
  userId: string,
  planId?: string | null,
): Promise<AthleteContext> {
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const since14Date = since14.slice(0, 10);

  const [actsRes, metricsRes, sleepRes, load7Res, nutRes, notesRes] = await Promise.all([
    sb
      .from("activities")
      .select("activity_type, start_time, distance_m, duration_s, avg_hr, avg_pace_s_per_km")
      .eq("user_id", userId)
      .gte("start_time", since90)
      .order("start_time", { ascending: false })
      .limit(60),
    sb
      .from("daily_metrics")
      .select("metric_date, resting_hr, hrv_avg, training_readiness, training_status, vo2max, vo2max_source")
      .eq("user_id", userId)
      .order("metric_date", { ascending: false })
      .limit(14),
    sb
      .from("sleep")
      .select("total_s")
      .eq("user_id", userId)
      .order("sleep_date", { ascending: false })
      .limit(7),
    sb
      .from("activities")
      .select("training_load")
      .eq("user_id", userId)
      .gte("start_time", since7),
    sb
      .from("nutrition_entries")
      .select("entry_date, calories, protein_g, carbs_g")
      .eq("user_id", userId)
      .gte("entry_date", since14Date),
    sb
      .from("training_notes")
      .select("note_date, content")
      .eq("user_id", userId)
      .order("note_date", { ascending: false })
      .limit(8),
  ]);

  const activites_recentes = (actsRes.data ?? []).map((a) => ({
    date: a.start_time ? String(a.start_time).slice(0, 10) : null,
    sport: a.activity_type,
    distance_km: a.distance_m ? +(a.distance_m / 1000).toFixed(2) : null,
    duree_min: a.duration_s ? Math.round(a.duration_s / 60) : null,
    allure: a.activity_type?.includes("running") ? fmtPace(a.avg_pace_s_per_km) : null,
    fc_moy: a.avg_hr ?? null,
  }));

  const sleeps = sleepRes.data ?? [];
  const sommeil_moy_7j_h = sleeps.length
    ? +(sleeps.reduce((s, x) => s + (x.total_s ?? 0), 0) / sleeps.length / 3600).toFixed(1)
    : null;
  const charge_7j = (load7Res.data ?? []).reduce((s, x) => s + (Number(x.training_load) || 0), 0);

  // Nutrition : moyenne journalière sur les jours renseignés.
  const byDay = new Map<string, { kcal: number; p: number; c: number }>();
  for (const r of nutRes.data ?? []) {
    const d = String(r.entry_date);
    const e = byDay.get(d) ?? { kcal: 0, p: 0, c: 0 };
    e.kcal += Number(r.calories ?? 0);
    e.p += Number(r.protein_g ?? 0);
    e.c += Number(r.carbs_g ?? 0);
    byDay.set(d, e);
  }
  let nutrition_14j: AthleteContext["nutrition_14j"] = null;
  if (byDay.size) {
    const days = [...byDay.values()];
    nutrition_14j = {
      jours_avec_donnees: days.length,
      kcal_moy: Math.round(days.reduce((s, x) => s + x.kcal, 0) / days.length),
      prot_moy: Math.round(days.reduce((s, x) => s + x.p, 0) / days.length),
      gluc_moy: Math.round(days.reduce((s, x) => s + x.c, 0) / days.length),
    };
  }

  const notes = (notesRes.data ?? []).map((n) => ({
    date: String(n.note_date),
    texte: String(n.content).slice(0, 300),
  }));

  // Réalisé vs cible (séances du plan faites, comparées à la cible).
  let realise_vs_cible: any[] | null = null;
  let realise_compteur: AthleteContext["realise_compteur"] = null;
  if (planId) {
    const { data: pw } = await sb
      .from("plan_workouts")
      .select("scheduled_date, session_type, status, target, completed_activity_id")
      .eq("plan_id", planId);
    if (pw) {
      realise_compteur = {
        done: pw.filter((x) => x.status === "done").length,
        missed: pw.filter((x) => x.status === "missed").length,
        planned: pw.filter((x) => x.status === "planned").length,
      };
      const done = pw
        .filter((x) => x.status === "done" && x.completed_activity_id)
        .sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)))
        .slice(0, 12);
      if (done.length) {
        const ids = done.map((d) => d.completed_activity_id);
        const { data: acts } = await sb
          .from("activities")
          .select("id, distance_m, avg_pace_s_per_km")
          .in("id", ids);
        const byId = new Map((acts ?? []).map((a) => [a.id, a]));
        realise_vs_cible = done.map((d) => {
          const a = byId.get(d.completed_activity_id);
          const t: any = d.target ?? {};
          return {
            date: d.scheduled_date,
            type: d.session_type,
            cible_allure: t.allure ?? null,
            cible_km: t.distance_km ?? null,
            realise_allure: a ? fmtPace(a.avg_pace_s_per_km) : null,
            realise_km: a?.distance_m ? +(a.distance_m / 1000).toFixed(2) : null,
          };
        });
      }
    }
  }

  const [profil, zones, charge, memoire] = await Promise.all([
    loadPhysio(sb, userId),
    athleteZones(sb, userId),
    trainingLoad(sb, userId),
    loadMemory(sb, userId),
  ]);

  return {
    profil,
    zones,
    charge,
    memoire,
    activites_recentes,
    recuperation: {
      indicateurs_recents: metricsRes.data ?? [],
      sommeil_moy_7j_h,
      charge_7j: charge_7j || null,
    },
    nutrition_14j,
    notes,
    realise_vs_cible,
    realise_compteur,
  };
}
