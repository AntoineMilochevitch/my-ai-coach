/**
 * Function : chat — conversation avec le coach, contextualisée par les données
 * de l'utilisateur (par sport) + RAG pgvector + historique de la conversation.
 * Multi-provider (Gemini / Claude / OpenAI), en streaming.
 *
 * POST { conversationId?, message }  + Authorization: Bearer <jwt supabase>
 *  -> flux texte (text/plain) + en-tête x-conversation-id
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { getLlm, isRateLimit, type ChatTurn, type TokenUsage } from "./_shared/llm/index.ts";
import { embed } from "./_shared/embeddings.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { checkQuota, recordUsage } from "./_shared/usage.ts";
import { mightBeAction, detectAction } from "./_shared/chat-actions.ts";

const MAX_MESSAGE_CHARS = 4000;

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

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const message = String(body.message ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
    if (!message) return json({ error: "message requis" }, 400);

    await checkQuota(sb, user.id, "chat");
    const cfg = await loadAiConfig(sb, user);
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);
    let conversationId: string | null = body.conversationId ?? null;

    // Conversation : vérifie l'appartenance ou en crée une.
    if (conversationId) {
      const { data } = await sb
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) conversationId = null;
    }
    if (!conversationId) {
      const { data, error } = await sb
        .from("conversations")
        .insert({ user_id: user.id, title: message.slice(0, 60) })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      conversationId = data.id;
    }

    // Enregistre le message utilisateur (id conservé pour rollback si échec).
    const { data: userMsg } = await sb
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "user",
        content: message,
      })
      .select("id")
      .single();
    const userMsgId = userMsg?.id;

    // --- Détection d'action (proposition confirmable) ---
    // Si le message demande explicitement une action (créer/adapter un plan,
    // ajouter nutrition/note), on répond par une PROPOSITION (carte à confirmer)
    // au lieu d'une réponse en streaming.
    if (mightBeAction(message)) {
      const { action, usage } = await detectAction(llm, message);
      if (action) {
        const payload = {
          kind: action.kind,
          args: action.args,
          summary: action.summary,
          status: "pending" as const,
        };
        const { data: am } = await sb
          .from("chat_messages")
          .insert({
            conversation_id: conversationId,
            user_id: user.id,
            role: "assistant",
            content: action.assistant,
            action: payload,
          })
          .select("id")
          .single();
        await recordUsage(sb, user.id, "chat", usage);
        return json({
          type: "proposal",
          conversationId,
          messageId: am?.id ?? null,
          content: action.assistant,
          action: payload,
        });
      }
    }

    // --- Contexte athlète (scopé au user) ---
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const [actsRes, metricsRes, sleepRes, analysisRes, historyRes, notesRes] =
      await Promise.all([
        sb
          .from("activities")
          .select("activity_type, start_time, distance_m, duration_s, avg_hr, avg_pace_s_per_km")
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
        // BUGFIX : on veut les messages RÉCENTS. descending + reverse() pour les
        // remettre dans l'ordre chronologique (avant : ascending → on n'envoyait
        // que les 16 PLUS ANCIENS, donc plus la question courante au-delà de 16).
        sb
          .from("chat_messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(16),
        sb
          .from("training_notes")
          .select("note_date, content")
          .eq("user_id", user.id)
          .order("note_date", { ascending: false })
          .limit(5),
      ]);

    const acts = actsRes.data ?? [];
    // Résumé par sport (90 j).
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
      return `- ${d} ${a.activity_type ?? "sport"} ${km} km/${min} min${pace}`;
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
        sb
          .from("plan_workouts")
          .select("*", { count: "exact", head: true })
          .eq("plan_id", plan.id),
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

    // --- RAG pgvector (best-effort, nécessite une config d'embeddings) ---
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
        // RAG optionnel : on continue sans si indisponible.
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

    // Historique récent -> ordre chronologique -> format neutre.
    const history = (historyRes.data ?? [])
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .reverse();
    const contents: ChatTurn[] = history.map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      text: msg.content,
    }));
    // La conversation envoyée au modèle DOIT commencer par un tour "user"
    // (exigé par Claude/Gemini) : on retire d'éventuels tours assistant en tête.
    while (contents.length && contents[0].role === "assistant") contents.shift();
    if (contents.length === 0) contents.push({ role: "user", text: message });

    // --- Génération en streaming (provider -> flux texte vers le client) ---
    let gen: Awaited<ReturnType<typeof llm.stream>>;
    try {
      gen = await llm.stream(system, contents, {
        temperature: 0.7,
        maxOutputTokens: 3072,
        signal: req.signal,
        timeoutMs: 8000, // borne l'établissement de la connexion (anti-504)
      });
    } catch (e) {
      // Échec avant tout token : on retire le message user pour ne pas le laisser
      // orphelin (sans réponse) dans la conversation.
      if (userMsgId)
        await sb.from("chat_messages").delete().eq("id", userMsgId).then(
          () => {},
          () => {},
        );
      throw e;
    }

    const convId = conversationId;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        let full = "";
        let usage: TokenUsage | null = null;
        try {
          for await (const chunk of gen) {
            if (chunk.text) {
              full += chunk.text;
              controller.enqueue(encoder.encode(chunk.text));
            }
            if (chunk.usage) usage = chunk.usage;
          }
        } catch {
          /* déconnexion client ou coupure upstream : on persiste le partiel */
        } finally {
          if (full) {
            await sb
              .from("chat_messages")
              .insert({
                conversation_id: convId,
                user_id: user.id,
                role: "assistant",
                content: full,
              })
              .then(
                () => {},
                () => {},
              );
          }
          await recordUsage(sb, user.id, "chat", usage);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-conversation-id": String(convId),
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (isRateLimit(err))
      return json(
        {
          error:
            "Limite de l'API atteinte sur les modèles disponibles. Réessaie dans un instant, ou change de modèle/fournisseur dans ton profil.",
        },
        429,
      );
    return json({ error: (err as Error).message }, 500);
  }
};
