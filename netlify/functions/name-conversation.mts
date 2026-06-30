/**
 * Function : name-conversation — génère un titre court pour une conversation via
 * le provider IA configuré, à partir des premiers messages. Met à jour
 * conversations.title et le renvoie.
 *
 * POST { conversationId }  + Authorization: Bearer <jwt>  -> { title }
 */
import { requireUser, HttpError, json } from "./_shared/supabase.ts";
import { getLlm } from "./_shared/llm/index.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { recordUsage } from "./_shared/usage.ts";

const SYSTEM = `Tu génères un TITRE très court pour une conversation de coaching sportif.
Règles STRICTES :
- 3 à 6 mots, en français.
- Pas de guillemets, pas de ponctuation finale, pas d'emoji.
- Résume le SUJET principal (ex. "Préparation semi-marathon", "Analyse charge et récupération").
Réponds uniquement par le titre.`;

function clean(raw: string): string {
  return raw
    .replace(/^["'«»\s]+|["'«».\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST requis" }, 405);
  try {
    const { user, sb } = await requireUser(req);
    const { conversationId } = await req.json().catch(() => ({}));
    if (!conversationId) return json({ error: "conversationId requis" }, 400);

    const { data: conv } = await sb
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!conv) return json({ error: "Conversation introuvable" }, 404);

    const { data: msgs } = await sb
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(4);
    if (!msgs?.length) return json({ error: "Conversation vide" }, 400);

    const cfg = await loadAiConfig(sb, user);
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    const transcript = msgs
      .map((m) => `${m.role === "assistant" ? "Coach" : "Athlète"}: ${String(m.content).slice(0, 500)}`)
      .join("\n");

    const { text, usage } = await llm.generate(SYSTEM, transcript, {
      temperature: 0.3,
      maxOutputTokens: 512,
      thinkingBudget: 0,
    });
    await recordUsage(sb, user.id, "chat", usage);

    const title = clean(text) || String(msgs[0].content).slice(0, 60);
    await sb.from("conversations").update({ title }).eq("id", conversationId);

    return json({ title });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
};
