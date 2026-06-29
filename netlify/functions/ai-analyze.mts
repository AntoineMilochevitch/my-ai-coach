/**
 * Function : ai-analyze — analyse de coach (Gemini) sur une période.
 * POST { days? }  + Authorization: Bearer <jwt supabase>
 *  -> { content_md, created_at }
 *
 * Lit les données récentes de l'utilisateur (service_role, scopé au JWT),
 * construit un résumé, demande une analyse structurée à Gemini, la persiste
 * dans ai_analyses, et la renvoie.
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { geminiGenerate, geminiModel } from "./_shared/gemini.ts";

const SYSTEM = `Tu es un coach sportif personnel expert, bienveillant et exigeant.
Tu analyses les données Garmin Connect d'un athlète (course/fitness) et tu donnes
des conseils concrets, personnalisés et actionnables. Réponds TOUJOURS en français,
en Markdown, avec ces sections :

## 📊 Bilan
Synthèse en 2-3 phrases de l'état de forme, de la charge et de la récupération.

## ✅ Points forts
Ce qui va bien (progression, régularité, récupération, sommeil, VO₂max...).

## ⚠️ Points de vigilance
Signaux à surveiller (fatigue, surcharge, sommeil insuffisant, FC repos en hausse,
monotonie de l'entraînement...).

## 🎯 Recommandations
3 à 5 conseils précis pour les prochains jours (intensité, volume, récupération).

## 🗓️ Cap pour la suite
Une orientation pour les 1-2 prochaines semaines selon les tendances.

Cite les chiffres pertinents. N'invente jamais une donnée manquante (null).
Si le VO₂max est "estimé" (source calculated), précise que c'est une estimation.`;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days) || 30, 7), 120);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [acts, metrics, sleep] = await Promise.all([
      sb
        .from("activities")
        .select(
          "activity_type,start_time,distance_m,duration_s,avg_hr,max_hr,avg_pace_s_per_km,training_load,aerobic_te,anaerobic_te",
        )
        .eq("user_id", user.id)
        .gte("start_time", since)
        .order("start_time", { ascending: false })
        .limit(60),
      sb
        .from("daily_metrics")
        .select(
          "metric_date,resting_hr,hrv_avg,stress_avg,vo2max,vo2max_source,training_readiness",
        )
        .eq("user_id", user.id)
        .order("metric_date", { ascending: false })
        .limit(14),
      sb
        .from("sleep")
        .select("sleep_date,total_s,deep_s,rem_s,score")
        .eq("user_id", user.id)
        .order("sleep_date", { ascending: false })
        .limit(14),
    ]);

    const summary = {
      periode_jours: days,
      activites: acts.data ?? [],
      metriques_quotidiennes: metrics.data ?? [],
      sommeil: sleep.data ?? [],
    };

    if ((summary.activites as unknown[]).length === 0) {
      return json(
        { error: "Aucune activité sur la période — synchronise d'abord ton Garmin." },
        400,
      );
    }

    const userText =
      "Voici mes données Garmin récentes (JSON). Analyse-les et coache-moi :\n\n" +
      "```json\n" +
      JSON.stringify(summary, null, 2) +
      "\n```";

    const content = await geminiGenerate(SYSTEM, userText);

    const period_end = new Date().toISOString().slice(0, 10);
    const period_start = since.slice(0, 10);
    await sb.from("ai_analyses").insert({
      user_id: user.id,
      scope: "period",
      period_start,
      period_end,
      model: geminiModel(),
      content_md: content,
      context: summary,
    });

    return json({ content_md: content, created_at: new Date().toISOString() });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
