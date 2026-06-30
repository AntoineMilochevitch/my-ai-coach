/**
 * Function : index-rag — construit/rafraîchit les embeddings (rag_chunks) du RAG
 * à partir de PLUSIEURS sources : activités, sommeil, métriques quotidiennes,
 * nutrition (agrégée par jour) et notes libres de l'athlète. Bornée par appel ;
 * renvoie `remaining` > 0 si l'appelant doit relancer pour finir un gros historique.
 *
 * POST {}  + Authorization: Bearer <jwt supabase>  -> { indexed, remaining }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { embed, type EmbedConfig } from "./_shared/embeddings.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { recordUsage } from "./_shared/usage.ts";

const BATCH = 40; // nb de chunks (ré)indexés par appel
const HARD_CAP = 800; // borne de sécurité par source

function fmtPace(sPerKm: number | null): string {
  if (!sPerKm || sPerKm <= 0) return "n/a";
  return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, "0")}/km`;
}

interface Item {
  sourceType: string;
  sourceId: string;
  content: string;
}

function activityText(a: any): string {
  const date = a.start_time ? String(a.start_time).slice(0, 10) : "date inconnue";
  const km = a.distance_m ? (a.distance_m / 1000).toFixed(2) : "?";
  const min = a.duration_s ? Math.round(a.duration_s / 60) : "?";
  const parts = [`Activité ${a.activity_type ?? "sport"} du ${date}`, `${km} km en ${min} min`];
  if (a.activity_type?.includes("running")) parts.push(`allure ${fmtPace(a.avg_pace_s_per_km)}`);
  if (a.avg_hr) parts.push(`FC moyenne ${a.avg_hr} bpm`);
  if (a.max_hr) parts.push(`FC max ${a.max_hr} bpm`);
  if (a.aerobic_te) parts.push(`Training Effect aérobie ${a.aerobic_te}`);
  if (a.anaerobic_te) parts.push(`anaérobie ${a.anaerobic_te}`);
  if (a.training_load) parts.push(`charge ${Math.round(a.training_load)}`);
  return parts.join(", ") + ".";
}

function metricText(m: any): string {
  const parts = [`Indicateurs du ${m.metric_date}`];
  if (m.resting_hr) parts.push(`FC repos ${m.resting_hr} bpm`);
  if (m.hrv_avg) parts.push(`HRV ${m.hrv_avg} ms`);
  if (m.stress_avg != null) parts.push(`stress ${m.stress_avg}/100`);
  if (m.vo2max) parts.push(`VO2max ${m.vo2max}${m.vo2max_source === "calculated" ? " (estimé)" : ""}`);
  if (m.training_readiness != null) parts.push(`readiness ${m.training_readiness}/100`);
  if (m.training_status) parts.push(`statut ${m.training_status}`);
  return parts.join(", ") + ".";
}

function sleepText(s: any): string {
  const h = (sec: number | null) => (sec ? (sec / 3600).toFixed(1) : "?");
  const parts = [`Sommeil du ${s.sleep_date}`, `durée ${h(s.total_s)} h`];
  if (s.deep_s) parts.push(`profond ${h(s.deep_s)} h`);
  if (s.rem_s) parts.push(`REM ${h(s.rem_s)} h`);
  if (s.score != null) parts.push(`score ${s.score}/100`);
  return parts.join(", ") + ".";
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const cfg = await loadAiConfig(sb, user);
    if (!cfg.embed)
      return json(
        { error: "Aucune clé compatible embeddings (Gemini ou OpenAI) configurée." },
        400,
      );
    const embedCfg: EmbedConfig = cfg.embed;

    // 1) Sources structurées Garmin + nutrition agrégée par jour + notes.
    const [actsRes, metricsRes, sleepRes, nutRes, notesRes] = await Promise.all([
      sb
        .from("activities")
        .select(
          "id, activity_type, start_time, distance_m, duration_s, avg_hr, max_hr, avg_pace_s_per_km, training_load, aerobic_te, anaerobic_te",
        )
        .eq("user_id", user.id)
        .order("start_time", { ascending: false })
        .limit(HARD_CAP),
      sb
        .from("daily_metrics")
        .select(
          "id, metric_date, resting_hr, hrv_avg, stress_avg, vo2max, vo2max_source, training_readiness, training_status",
        )
        .eq("user_id", user.id)
        .order("metric_date", { ascending: false })
        .limit(HARD_CAP),
      sb
        .from("sleep")
        .select("id, sleep_date, total_s, deep_s, rem_s, score")
        .eq("user_id", user.id)
        .order("sleep_date", { ascending: false })
        .limit(HARD_CAP),
      sb
        .from("nutrition_entries")
        .select("entry_date, calories, protein_g, carbs_g, fat_g")
        .eq("user_id", user.id)
        .order("entry_date", { ascending: false })
        .limit(2000),
      sb
        .from("training_notes")
        .select("id, note_date, content")
        .eq("user_id", user.id)
        .order("note_date", { ascending: false })
        .limit(HARD_CAP),
    ]);

    const items: Item[] = [];
    for (const a of actsRes.data ?? [])
      items.push({ sourceType: "activity", sourceId: a.id, content: activityText(a) });
    for (const m of metricsRes.data ?? [])
      items.push({ sourceType: "daily_metric", sourceId: m.id, content: metricText(m) });
    for (const s of sleepRes.data ?? [])
      items.push({ sourceType: "sleep", sourceId: s.id, content: sleepText(s) });
    for (const n of notesRes.data ?? [])
      items.push({
        sourceType: "note",
        sourceId: n.id,
        content: `Note du ${n.note_date} : ${String(n.content).slice(0, 1000)}`,
      });

    // Nutrition : agrégat journalier (1 chunk par jour).
    const byDay = new Map<string, { kcal: number; p: number; c: number; f: number }>();
    for (const r of nutRes.data ?? []) {
      const d = String(r.entry_date);
      const e = byDay.get(d) ?? { kcal: 0, p: 0, c: 0, f: 0 };
      e.kcal += Number(r.calories ?? 0);
      e.p += Number(r.protein_g ?? 0);
      e.c += Number(r.carbs_g ?? 0);
      e.f += Number(r.fat_g ?? 0);
      byDay.set(d, e);
    }
    for (const [d, e] of byDay)
      items.push({
        sourceType: "nutrition",
        sourceId: d,
        content: `Nutrition du ${d} : ${Math.round(e.kcal)} kcal, ${Math.round(e.p)} g protéines, ${Math.round(e.c)} g glucides, ${Math.round(e.f)} g lipides.`,
      });

    // 2) Quels chunks manquent pour le modèle d'embedding courant ?
    const { data: existing } = await sb
      .from("rag_chunks")
      .select("source_type, source_id")
      .eq("user_id", user.id)
      .eq("embed_model", embedCfg.model);
    const have = new Set((existing ?? []).map((r) => `${r.source_type}:${r.source_id}`));
    const missing = items.filter((it) => !have.has(`${it.sourceType}:${it.sourceId}`));
    const todo = missing.slice(0, BATCH);

    // 3) Embeddings (concurrence bornée) + upsert.
    let embedded = 0;
    const limit = 5;
    let i = 0;
    const rows: any[] = new Array(todo.length);
    await Promise.all(
      Array.from({ length: Math.min(limit, todo.length) }, async () => {
        while (i < todo.length) {
          const idx = i++;
          const it = todo[idx];
          const embedding = await embed(embedCfg, it.content);
          embedded++;
          rows[idx] = {
            user_id: user.id,
            source_type: it.sourceType,
            source_id: it.sourceId,
            content: it.content,
            embedding,
            embed_model: embedCfg.model,
          };
        }
      }),
    );

    if (rows.length) {
      const { error } = await sb
        .from("rag_chunks")
        .upsert(rows, { onConflict: "user_id,source_type,source_id" });
      if (error) throw new Error(`upsert rag_chunks: ${error.message}`);
    }
    if (embedded) await recordUsage(sb, user.id, "embed", { in: embedded, out: 0 });

    return json({ indexed: rows.length, remaining: missing.length - rows.length });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
