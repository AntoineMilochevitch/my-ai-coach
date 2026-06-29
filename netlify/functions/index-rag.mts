/**
 * Function : index-rag — construit les embeddings (rag_chunks) des activités
 * pas encore indexées. Appelée après une synchro. Bornée par appel pour tenir
 * dans le timeout ; relancer pour finir un gros historique.
 *
 * POST {}  + Authorization: Bearer <jwt supabase>  -> { indexed, remaining }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { embed } from "./_shared/embeddings.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";

const BATCH = 40; // max d'activités embeddées par appel

function fmtPace(sPerKm: number | null): string {
  if (!sPerKm || sPerKm <= 0) return "n/a";
  return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, "0")}/km`;
}

function activityText(a: any): string {
  const date = a.start_time ? String(a.start_time).slice(0, 10) : "date inconnue";
  const km = a.distance_m ? (a.distance_m / 1000).toFixed(2) : "?";
  const min = a.duration_s ? Math.round(a.duration_s / 60) : "?";
  const parts = [
    `Activité ${a.activity_type ?? "sport"} du ${date}`,
    `${km} km en ${min} min`,
  ];
  if (a.activity_type?.includes("running")) parts.push(`allure ${fmtPace(a.avg_pace_s_per_km)}`);
  if (a.avg_hr) parts.push(`FC moyenne ${a.avg_hr} bpm`);
  if (a.max_hr) parts.push(`FC max ${a.max_hr} bpm`);
  if (a.aerobic_te) parts.push(`Training Effect aérobie ${a.aerobic_te}`);
  if (a.anaerobic_te) parts.push(`anaérobie ${a.anaerobic_te}`);
  if (a.training_load) parts.push(`charge ${Math.round(a.training_load)}`);
  return parts.join(", ") + ".";
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const cfg = await loadAiConfig(sb, user.id);

    const { data: acts } = await sb
      .from("activities")
      .select(
        "id, activity_type, start_time, distance_m, duration_s, avg_hr, max_hr, avg_pace_s_per_km, training_load, aerobic_te, anaerobic_te",
      )
      .eq("user_id", user.id)
      .order("start_time", { ascending: false })
      .limit(300);

    const { data: existing } = await sb
      .from("rag_chunks")
      .select("source_id")
      .eq("user_id", user.id)
      .eq("source_type", "activity");
    const indexed = new Set((existing ?? []).map((r) => r.source_id));

    const missing = (acts ?? []).filter((a) => !indexed.has(a.id));
    const todo = missing.slice(0, BATCH);

    const rows = await mapLimit(todo, 5, async (a) => {
      const content = activityText(a);
      const embedding = await embed(cfg.apiKey, content);
      return {
        user_id: user.id,
        source_type: "activity",
        source_id: a.id,
        content,
        embedding,
      };
    });

    if (rows.length) {
      const { error } = await sb.from("rag_chunks").insert(rows);
      if (error) throw new Error(`insert rag_chunks: ${error.message}`);
    }

    return json({ indexed: rows.length, remaining: missing.length - rows.length });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
