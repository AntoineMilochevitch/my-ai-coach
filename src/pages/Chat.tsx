import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Markdown from "react-markdown";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  chatBackground,
  nameConversation,
  generatePlan,
  adaptPlan,
  createWorkout,
  editWorkout,
  type ChatAction,
} from "../lib/api";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";

interface Msg {
  id?: string;
  created_at?: string;
  role: "user" | "assistant";
  content: string;
  action?: ChatAction | null;
}

const ACTION_LABEL: Record<string, string> = {
  create_plan: "Nouveau plan d'entraînement",
  adapt_plan: "Adapter le plan à ta forme",
  add_nutrition: "Ajouter à ton journal nutrition",
  add_note: "Ajouter une note",
  create_workout: "Créer et envoyer une séance sur Garmin",
  edit_workout: "Modifier une séance du plan",
};
const ACTION_ICON: Record<string, string> = {
  create_plan: "calendar-outline",
  adapt_plan: "sync-outline",
  add_nutrition: "restaurant-outline",
  add_note: "document-text-outline",
  create_workout: "watch-outline",
  edit_workout: "create-outline",
};
const today = () => new Date().toISOString().slice(0, 10);
interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
}

export default function Chat() {
  const { session } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [editFrom, setEditFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, created_at")
      .order("created_at", { ascending: false });
    setConversations(data ?? []);
    return data ?? [];
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from("chat_messages")
      .select("id, created_at, role, content, action")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    setMessages(
      (data ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          created_at: m.created_at,
          role: m.role as "user" | "assistant",
          content: m.content,
          action: (m.action as ChatAction | null) ?? null,
        })),
    );
  }, []);

  useEffect(() => {
    (async () => {
      const convs = await loadConversations();
      if (convs.length) {
        setConversationId(convs[0].id);
        await loadMessages(convs[0].id);
      }
    })();
  }, [loadConversations, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Attend l'apparition de la réponse de l'assistant (écrite par la fonction
  // d'arrière-plan). Renvoie true si trouvée, false après expiration.
  async function pollAssistant(convId: string, sinceIso: string): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < 180000) {
      await new Promise((r) => setTimeout(r, 2500));
      const { data } = await supabase
        .from("chat_messages")
        .select("id")
        .eq("conversation_id", convId)
        .eq("role", "assistant")
        .gt("created_at", sinceIso)
        .limit(1)
        .maybeSingle();
      if (data) return true;
    }
    return false;
  }

  async function doSend(text: string) {
    const uid = session?.user.id;
    if (!uid) return;
    setBusy(true);
    setError(null);
    const wasNew = !conversationId;
    let convId = conversationId;
    try {
      // 1. Conversation (créée si nouvelle).
      if (!convId) {
        const { data, error: e } = await supabase
          .from("conversations")
          .insert({ user_id: uid, title: text.slice(0, 60) })
          .select("id")
          .single();
        if (e) throw new Error(e.message);
        convId = data.id;
        setConversationId(convId);
      }
      // 2. Message utilisateur.
      const { data: um, error: e2 } = await supabase
        .from("chat_messages")
        .insert({ conversation_id: convId, user_id: uid, role: "user", content: text })
        .select("id, created_at")
        .single();
      if (e2) throw new Error(e2.message);
      // Bulles optimistes : message user + réponse assistant (spinner pendant l'attente).
      setMessages((m) => [
        ...m,
        { id: um.id, created_at: um.created_at, role: "user", content: text },
        { role: "assistant", content: "" },
      ]);
      // 3. Génération EN ARRIÈRE-PLAN, puis attente de la réponse.
      await chatBackground(convId as string);
      const ok = await pollAssistant(convId as string, um.created_at as string);
      if (!ok) {
        setError("Le coach met vraiment trop de temps. Réessaie dans un moment.");
        setMessages((m) =>
          m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m,
        );
      } else {
        await loadMessages(convId as string); // récupère la réponse (texte ou carte d'action)
        if (wasNew) {
          await loadConversations();
          nameConversation(convId as string)
            .then(({ title }) =>
              setConversations((cs) => cs.map((c) => (c.id === convId ? { ...c, title } : c))),
            )
            .catch(() => {});
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setMessages((m) =>
        m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m,
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    // Édition : supprime les messages à partir du point édité (DB + vue).
    if (editFrom && conversationId) {
      await supabase
        .from("chat_messages")
        .delete()
        .eq("conversation_id", conversationId)
        .gte("created_at", editFrom);
      setEditFrom(null);
    }
    await doSend(text);
  }

  function startEdit(msg: Msg) {
    if (!msg.created_at) return;
    setInput(msg.content);
    setEditFrom(msg.created_at);
    setMessages((m) => {
      const idx = m.findIndex((x) => x.created_at === msg.created_at);
      return idx >= 0 ? m.slice(0, idx) : m;
    });
  }

  async function regenerate() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser?.created_at || !conversationId || busy) return;
    await supabase
      .from("chat_messages")
      .delete()
      .eq("conversation_id", conversationId)
      .gte("created_at", lastUser.created_at);
    setMessages((m) => {
      const idx = m.findIndex((x) => x.created_at === lastUser.created_at);
      return idx >= 0 ? m.slice(0, idx) : m;
    });
    await doSend(lastUser.content);
  }

  async function setActionStatus(m: Msg, status: ChatAction["status"]) {
    if (!m.id || !m.action) return;
    const next: ChatAction = { ...m.action, status };
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, action: next } : x)));
    await supabase.from("chat_messages").update({ action: next }).eq("id", m.id);
  }

  // Exécute l'action proposée par le coach (après confirmation de l'athlète).
  async function confirmAction(m: Msg) {
    if (!m.action || busy) return;
    const a = m.action;
    const uid = session?.user.id;
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      if (a.kind === "create_plan") {
        await generatePlan(a.args as any);
      } else if (a.kind === "adapt_plan") {
        await adaptPlan();
      } else if (a.kind === "add_nutrition") {
        const date = (a.args.date as string) || today();
        const meal = (a.args.meal as string) || "Collation";
        const items = Array.isArray(a.args.items) ? a.args.items : [];
        const rows = items.map((it: any) => ({
          user_id: uid,
          entry_date: date,
          meal,
          label: String(it.label || "Aliment"),
          calories: it.calories ?? null,
          protein_g: it.protein_g ?? null,
          carbs_g: it.carbs_g ?? null,
          fat_g: it.fat_g ?? null,
        }));
        if (rows.length) {
          const { error: e } = await supabase.from("nutrition_entries").insert(rows);
          if (e) throw new Error(e.message);
        }
      } else if (a.kind === "add_note") {
        const { error: e } = await supabase.from("training_notes").insert({
          user_id: uid,
          note_date: (a.args.date as string) || today(),
          content: String(a.args.content || a.summary),
        });
        if (e) throw new Error(e.message);
      } else if (a.kind === "create_workout") {
        await createWorkout(a.args);
      } else if (a.kind === "edit_workout") {
        await editWorkout(String(a.args.date || ""), a.args);
      }
      await setActionStatus(m, "applied");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setEditFrom(null);
    setError(null);
    setSidebarOpen(false);
  }

  async function selectConversation(id: string) {
    if (id === conversationId) {
      setSidebarOpen(false);
      return;
    }
    setConversationId(id);
    setEditFrom(null);
    setError(null);
    setSidebarOpen(false);
    await loadMessages(id);
  }

  async function deleteConversation(id: string) {
    if (!window.confirm("Supprimer cette conversation ?")) return;
    await supabase.from("conversations").delete().eq("id", id);
    const rest = conversations.filter((c) => c.id !== id);
    setConversations(rest);
    if (id === conversationId) {
      if (rest.length) {
        setConversationId(rest[0].id);
        await loadMessages(rest[0].id);
      } else {
        newConversation();
      }
    }
  }

  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";

  return (
    <Layout>
      <div className="relative flex w-full flex-1 overflow-hidden">
        {/* Overlay mobile */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-10 bg-black/30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar : liste des conversations */}
        <aside
          className={`${
            sidebarOpen ? "flex" : "hidden"
          } absolute inset-y-0 left-0 z-20 w-64 flex-col border-r border-neutral-200 bg-white p-3 md:static md:flex dark:border-neutral-800 dark:bg-neutral-950`}
        >
          <button
            onClick={newConversation}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
          >
            <ion-icon name="add-outline" className="text-base"></ion-icon>
            Nouvelle conversation
          </button>
          <ul className="mt-3 flex-1 space-y-1 overflow-y-auto">
            {conversations.length === 0 && (
              <li className="px-2 py-1 text-xs text-neutral-500">Aucune conversation.</li>
            )}
            {conversations.map((c) => (
              <li
                key={c.id}
                className={`group flex items-center gap-1 rounded-lg ${
                  c.id === conversationId
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
              >
                <button
                  onClick={() => selectConversation(c.id)}
                  className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm text-neutral-700 dark:text-neutral-300"
                  title={c.title ?? "Sans titre"}
                >
                  {c.title || "Sans titre"}
                </button>
                <button
                  onClick={() => deleteConversation(c.id)}
                  className="shrink-0 px-1.5 text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:text-red-600"
                  aria-label="Supprimer la conversation"
                >
                  <ion-icon name="trash-outline"></ion-icon>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Zone de chat : occupe la place restante, contenu centré et borné en largeur */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden p-4">
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-neutral-300 p-1.5 text-neutral-600 md:hidden dark:border-neutral-700 dark:text-neutral-300"
              aria-label="Ouvrir les conversations"
            >
              <ion-icon name="menu-outline" className="text-base"></ion-icon>
            </button>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Coach IA</h1>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto pb-4">
            {messages.length === 0 && !busy && (
              <p className="mt-8 text-center text-sm text-neutral-500">
                Pose une question à ton coach : « Comment s'est passée ma semaine ? »,
                « Suis-je en surcharge ? », « Quelle séance aujourd'hui ? »
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={m.id ?? i}
                className={`group flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[85%]">
                  <div
                    className={`rounded-2xl px-4 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : "border border-neutral-200 bg-white text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      <>
                        {m.content ? (
                          <div className="markdown">
                            <Markdown>{m.content}</Markdown>
                          </div>
                        ) : (
                          !m.action && <Spinner />
                        )}
                        {m.action && (
                          <div className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                              <ion-icon name={ACTION_ICON[m.action.kind] ?? "flash-outline"}></ion-icon>
                              {ACTION_LABEL[m.action.kind] ?? "Action proposée"}
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
                              {m.action.summary}
                            </p>
                            {m.action.status === "pending" ? (
                              <div className="mt-2 flex gap-2">
                                <button
                                  onClick={() => confirmAction(m)}
                                  disabled={busy}
                                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                                >
                                  Confirmer
                                </button>
                                <button
                                  onClick={() => setActionStatus(m, "cancelled")}
                                  disabled={busy}
                                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300"
                                >
                                  Annuler
                                </button>
                              </div>
                            ) : m.action.status === "applied" ? (
                              <p className="mt-2 inline-flex flex-wrap items-center gap-1 text-xs text-green-600">
                                <ion-icon name="checkmark-circle-outline"></ion-icon>
                                {m.action.kind === "create_workout" ? " Envoyée sur Garmin" : " Appliqué"}
                                {(m.action.kind === "create_plan" ||
                                  m.action.kind === "adapt_plan" ||
                                  m.action.kind === "edit_workout") && (
                                  <Link to="/plan" className="underline">— voir le plan</Link>
                                )}
                                {m.action.kind === "add_nutrition" && (
                                  <Link to="/nutrition" className="underline">— voir la nutrition</Link>
                                )}
                              </p>
                            ) : (
                              <p className="mt-2 text-xs text-neutral-400">Annulé</p>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      m.content
                    )}
                  </div>
                  {m.role === "user" && m.created_at && !busy && (
                    <button
                      onClick={() => startEdit(m)}
                      className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:text-neutral-600"
                    >
                      <ion-icon name="create-outline"></ion-icon>
                      Modifier
                    </button>
                  )}
                </div>
              </div>
            ))}
            {lastIsAssistant && !busy && messages.length > 0 && (
              <div className="flex justify-start">
                <button
                  onClick={regenerate}
                  className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600"
                >
                  <ion-icon name="refresh-outline"></ion-icon>
                  Régénérer
                </button>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {error && <p className="pb-2 text-sm text-red-600">{error}</p>}

          <form onSubmit={onSubmit} className="flex gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={editFrom ? "Modifie ton message…" : "Écris ton message…"}
              className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Envoyer
            </button>
          </form>
          </div>
        </main>
      </div>
    </Layout>
  );
}
