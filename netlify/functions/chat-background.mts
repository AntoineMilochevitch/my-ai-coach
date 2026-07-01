/**
 * Function (BACKGROUND) : chat-background — génère la réponse du coach (ou une
 * PROPOSITION d'action) et l'écrit dans chat_messages. Le client a déjà inséré le
 * message utilisateur ; il interroge (poll) la table jusqu'à l'apparition de la
 * réponse de l'assistant.
 *
 * En arrière-plan : pas de limite 10 s → timeouts généreux + repli sur TOUS les
 * modèles disponibles (fonctionne même si le modèle principal est épuisé/lent).
 *
 * POST { conversationId }  + Authorization: Bearer <jwt>  -> 202
 */
import { requireUser, HttpError } from "./_shared/supabase.ts";
import { getLlm, isRateLimit, type ChatTurn, type TokenUsage } from "./_shared/llm/index.ts";
import { embed } from "./_shared/embeddings.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { checkQuota, recordUsage } from "./_shared/usage.ts";
import { mightBeAction, detectAction } from "./_shared/chat-actions.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const SYSTEM_BASE = `Tu es le coach sportif personnel de cet athlète (course/vélo/fitness).
Tu discutes avec lui de sa forme, de son entraînement et de son plan d'entraînement.
Règles :
- Réponds en français, tutoiement, de façon concise, concrète et actionnable.
- Appuie-toi sur SES données fournies dans le CONTEXTE (cite des chiffres réels, en
  unités lisibles : km, mm:ss/km, h:mm, bpm). Distingue bien les sports.
- N'invente JAMAIS une donnée absente ; si une info manque, dis-le et propose comment
  l'obtenir (synchroniser, préciser un objectif...).
- Tiens compte des NOTES de l'athlète (ressenti, blessures, contexte) quand elles existent.
- Pose une question de clarification si la demande est ambiguë.
- Reste dans ton rôle de coach ; pas de conseils médicaux au-delà du bon sens.`;

function fmtPace(sPerKm: number | null): string {
  if (!sPerKm || sPerKm <= 0) return "n/a";
  return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, "0")}/km`;
}

async function writeAssistant(
  sb: SupabaseClient,
  conversationId: string,
  userId: string,
  content: string,
  action: Record<string, unknown> | null = null,
): Promise<void> {
  await sb
    .from("chat_messages")
    .insert({ conversation_id: conversationId, user_id: userId, role: "assistant", content, action })
    .then(
      () => {},
      () => {},
    );
}

export default async (req: Request): Promise<Response> => {
  const ok202 = () => new Response("", { status: 202 });
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  try {
    ctx = await requireUser(req);
  } catch {
    return ok202();
  }
  const { user, sb } = ctx;
  const body = await req.json().catch(() => ({}));
  const conversationId: string | null = body.conversationId ?? null;
  if (!conversationId) return ok202();

  // Vérifie l'appartenance de la conversation.
  const { data: conv } = await sb
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conv) return ok202();

  // Le dernier message doit être un message utilisateur sans réponse.
  const { data: allMsgs } = await sb
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const list = (allMsgs ?? []).filter((x) => x.role === "user" || x.role === "assistant");
  const last = list[list.length - 1];
  if (!last || last.role !== "user") return ok202(); // rien à répondre
  const message = String(last.content).slice(0, 4000);

  try {
    await checkQuota(sb, user.id, "chat");
  } catch (e) {
    await writeAssistant(
      sb,
      conversationId,
      user.id,
      e instanceof HttpError ? e.message : "Limite quotidienne atteinte.",
    );
    return ok202();
  }

  let cfg: Awaited<ReturnType<typeof loadAiConfig>>;
  try {
    cfg = await loadAiConfig(sb, user);
  } catch (e) {
    await writeAssistant(sb, conversationId, user.id, (e as Error).message);
    return ok202();
  }
  const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

  try {
    // --- Détection d'action (proposition confirmable) ---
    if (mightBeAction(message)) {
      const detected = await detectAction(llm, message);
      if (detected.action) {
        await recordUsage(sb, user.id, "chat", detected.usage);
        await writeAssistant(sb, conversationId, user.id, detected.action.assistant, {
          kind: detected.action.kind,
          args: detected.action.args,
          summary: detected.action.summary,
          status: "pending",
        });
        return ok202();
      }
    }

    // --- Contexte athlète (scopé au user) ---
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const [actsRes, metricsRes, sleepRes, analysisRes, notesRes] = await Promise.all([
      sb
        .from("activities")
        .select(
          "activity_type, start_time, distance_m, duration_s, avg_hr, max_hr, avg_pace_s_per_km, training_load, aerobic_te, anaerobic_te",
        )
        .eq("user_id", user.id)
        .gte("start_time", since90)
        .order("start_time", { ascending: false })
        .limit(120),
      sb
        .from("daily_metrics")
        .select("metric_date, resting_hr, hrv_avg, stress_avg, vo2max, vo2max_source, training_readiness")
        .eq("user_id", user.id)
        .order("metric_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("sleep")
        .select("score, total_s")
        .eq("user_id", user.id)
        .order("sleep_date", { ascending: false })
        .limit(7),
      sb
        .from("ai_analyses")
        .select("content_md, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("training_notes")
        .select("note_date, content")
        .eq("user_id", user.id)
        .order("note_date", { ascending: false })
        .limit(5),
    ]);

    const acts = actsRes.data ?? [];
    const bySport = new Map<
      string,
      { n: number; km: number; paceSum: number; paceN: number; hrSum: number; hrN: number }
    >();
    for (const a of acts) {
      const key = a.activity_type ?? "autre";
      const e = bySport.get(key) ?? { n: 0, km: 0, paceSum: 0, paceN: 0, hrSum: 0, hrN: 0 };
      e.n++;
      e.km += (a.distance_m ?? 0) / 1000;
      if (a.avg_pace_s_per_km) {
        e.paceSum += a.avg_pace_s_per_km;
        e.paceN++;
      }
      if (a.avg_hr) {
        e.hrSum += a.avg_hr;
        e.hrN++;
      }
      bySport.set(key, e);
    }
    const sportLines = [...bySport.entries()].map(([sport, e]) => {
      const pace = e.paceN ? `, allure moy ${fmtPace(e.paceSum / e.paceN)}` : "";
      const hr = e.hrN ? `, FC moy ${Math.round(e.hrSum / e.hrN)} bpm` : "";
      return `- ${sport} : ${e.n} séances, ${e.km.toFixed(1)} km${pace}${hr}`;
    });

    const m = metricsRes.data;
    const sleeps = sleepRes.data ?? [];
    const avgSleepH = sleeps.length
      ? (sleeps.reduce((s, x) => s + (x.total_s ?? 0), 0) / sleeps.length / 3600).toFixed(1)
      : null;

    const recent = acts.slice(0, 8).map((a) => {
      const d = a.start_time ? String(a.start_time).slice(0, 10) : "?";
      const km = a.distance_m ? (a.distance_m / 1000).toFixed(1) : "?";
      const min = a.duration_s ? Math.round(a.duration_s / 60) : "?";
      const pace = a.activity_type?.includes("running") ? ` ${fmtPace(a.avg_pace_s_per_km)}` : "";
      const hr = a.avg_hr ? `, FC moy ${a.avg_hr}${a.max_hr ? `/max ${a.max_hr}` : ""} bpm` : "";
      const load = a.training_load ? `, charge ${Math.round(a.training_load)}` : "";
      const te = a.aerobic_te ? `, TE aéro ${a.aerobic_te}${a.anaerobic_te ? `/anaéro ${a.anaerobic_te}` : ""}` : "";
      return `- ${d} ${a.activity_type ?? "sport"} ${km} km/${min} min${pace}${hr}${load}${te}`;
    });

    const notes = notesRes.data ?? [];
    const notesText = notes.length
      ? "\n## Notes de l'athlète\n" +
        notes.map((n) => `- ${n.note_date} : ${String(n.content).slice(0, 300)}`).join("\n")
      : "";

    // --- Plan d'entraînement actif ---
    let planText = "";
    const { data: plan } = await sb
      .from("training_plans")
      .select("id, goal, start_date, end_date")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (plan) {
      const today = new Date().toISOString().slice(0, 10);
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const [upcoming, totalRes, doneRes] = await Promise.all([
        sb
          .from("plan_workouts")
          .select("scheduled_date, sport, session_type, title, status, target")
          .eq("plan_id", plan.id)
          .gte("scheduled_date", today)
          .lte("scheduled_date", in7)
          .order("scheduled_date", { ascending: true }),
        sb.from("plan_workouts").select("*", { count: "exact", head: true }).eq("plan_id", plan.id),
        sb
          .from("plan_workouts")
          .select("*", { count: "exact", head: true })
          .eq("plan_id", plan.id)
          .eq("status", "done"),
      ]);
      const lines = (upcoming.data ?? []).map((w: any) => {
        const t = w.target ?? {};
        const extra = [t.distance_km ? `${t.distance_km} km` : "", t.allure ? `@${t.allure}` : ""]
          .filter(Boolean)
          .join(" ");
        return `- ${w.scheduled_date} [${w.session_type}] ${w.title} (${w.sport}) ${extra} — ${w.status}`;
      });
      planText =
        `\n## Plan actif : ${plan.goal} (${plan.start_date} → ${plan.end_date}), ` +
        `avancement ${doneRes.count ?? 0}/${totalRes.count ?? 0}\n` +
        `### Séances des 7 prochains jours\n${lines.length ? lines.join("\n") : "- aucune"}`;
    }

    // --- RAG pgvector (best-effort) ---
    let ragText = "";
    if (cfg.embed) {
      try {
        const queryEmbedding = await embed(cfg.embed, message);
        const { data: chunks } = await sb.rpc("match_rag_chunks", {
          p_user_id: user.id,
          query_embedding: queryEmbedding,
          match_count: 6,
          p_embed_model: cfg.embed.model,
        });
        if (Array.isArray(chunks) && chunks.length) {
          ragText =
            "\n\n# EXTRAITS PERTINENTS (recherche sémantique)\n" +
            chunks.map((c: any) => `- ${c.content}`).join("\n");
        }
        recordUsage(sb, user.id, "embed");
      } catch {
        /* RAG optionnel */
      }
    }

    const context = [
      "# CONTEXTE ATHLÈTE",
      "## Par sport (90 derniers jours)",
      sportLines.length ? sportLines.join("\n") : "- aucune activité récente",
      "## Indicateurs récents",
      m
        ? `- VO₂max ${m.vo2max ?? "n/a"} (${m.vo2max_source === "calculated" ? "estimé" : m.vo2max_source ?? "n/a"}), FC repos ${m.resting_hr ?? "n/a"} bpm, HRV ${m.hrv_avg ?? "n/a"}, readiness ${m.training_readiness ?? "n/a"}/100`
        : "- non disponibles",
      avgSleepH ? `- Sommeil moyen (7 j) : ${avgSleepH} h` : "",
      "## Activités récentes",
      recent.length ? recent.join("\n") : "- aucune",
      analysisRes.data?.content_md
        ? `\n## Dernière analyse du coach (extrait)\n${analysisRes.data.content_md.slice(0, 700)}`
        : "",
      notesText,
      planText,
      ragText,
    ]
      .filter(Boolean)
      .join("\n");

    const system = `${SYSTEM_BASE}\n\n${context}`;

    // Historique -> ordre chronologique -> tours neutres (commence par "user").
    const contents: ChatTurn[] = list.map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      text: msg.content,
    }));
    while (contents.length && contents[0].role === "assistant") contents.shift();
    if (contents.length === 0) contents.push({ role: "user", text: message });

    // --- Génération (arrière-plan : on consomme le flux en entier, généreux) ---
    const gen = await llm.stream(system, contents.slice(-16), {
      temperature: 0.7,
      maxOutputTokens: 3072,
      timeoutMs: 40000,
      perAttemptMs: 10000,
      signal: AbortSignal.timeout(120000),
    });
    let full = "";
    let usage: TokenUsage | null = null;
    for await (const chunk of gen) {
      if (chunk.text) full += chunk.text;
      if (chunk.usage) usage = chunk.usage;
    }
    await recordUsage(sb, user.id, "chat", usage);
    await writeAssistant(
      sb,
      conversationId,
      user.id,
      full || "Désolé, je n'ai pas pu générer de réponse. Réessaie.",
    );
  } catch (e) {
    const msg = isRateLimit(e)
      ? "Limite de l'API atteinte sur les modèles disponibles. Réessaie plus tard, ou change de modèle/fournisseur dans ton profil."
      : `Je n'ai pas pu répondre (${(e as Error).message.slice(0, 160)}).`;
    await writeAssistant(sb, conversationId, user.id, msg);
  }
  return ok202();
};
