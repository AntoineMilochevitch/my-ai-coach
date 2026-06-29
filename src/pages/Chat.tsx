import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import { supabase } from "../lib/supabase";
import { chatStream } from "../lib/api";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";

interface Msg {
  id?: string;
  created_at?: string;
  role: "user" | "assistant";
  content: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [editFrom, setEditFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from("chat_messages")
      .select("id, created_at, role, content")
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
        })),
    );
  }, []);

  useEffect(() => {
    (async () => {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (conv) {
        setConversationId(conv.id);
        await loadMessages(conv.id);
      }
    })();
  }, [loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function doSend(text: string) {
    setBusy(true);
    setError(null);
    // Bulles optimistes : message user + réponse assistant (vide, remplie en streaming).
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    try {
      const { conversationId: convId } = await chatStream(text, conversationId, (chunk) => {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
      });
      setConversationId(convId);
      if (convId) await loadMessages(convId); // récupère ids/created_at pour l'édition
    } catch (err) {
      setError((err as Error).message);
      // retire la bulle assistant vide
      setMessages((m) => (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content ? m.slice(0, -1) : m));
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
    // Retire de la vue tout ce qui suit (inclus) le message édité.
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

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setEditFrom(null);
    setError(null);
  }

  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";

  return (
    <Layout>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden p-4">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Coach IA
          </h1>
          <button
            onClick={newConversation}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ion-icon name="add-outline" className="text-base"></ion-icon>
            Nouvelle conversation
          </button>
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
                    m.content ? (
                      <div className="markdown">
                        <Markdown>{m.content}</Markdown>
                      </div>
                    ) : (
                      <Spinner />
                    )
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
      </main>
    </Layout>
  );
}
