import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { indexRagAll } from "../lib/api";

interface Note {
  id: string;
  note_date: string;
  content: string;
}

/**
 * Notes libres de l'athlète (ressenti, blessures, contexte). Elles enrichissent
 * le RAG : le coach IA peut s'y référer en conversation.
 */
export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [content, setContent] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("training_notes")
      .select("id, note_date, content")
      .order("note_date", { ascending: false })
      .limit(30);
    setNotes(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const { data: u } = await supabase.auth.getUser();
    const { error: insErr } = await supabase
      .from("training_notes")
      .insert({ user_id: u.user?.id, note_date: date, content: text });
    setBusy(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setContent("");
    await load();
    indexRagAll().catch(() => {}); // indexe la nouvelle note pour le RAG
  }

  async function remove(id: string) {
    setNotes((n) => n.filter((x) => x.id !== id));
    await supabase.from("training_notes").delete().eq("id", id);
  }

  const inputCls =
    "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
        <ion-icon name="document-text-outline" className="text-base"></ion-icon>
        Notes & ressenti
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Ajoute du contexte libre (fatigue, douleur, motivation, contraintes). Ton coach IA
        en tiendra compte.
      </p>

      <form onSubmit={add} className="mt-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <textarea
          rows={2}
          placeholder="ex. Genou droit sensible après la sortie longue, sommeil moyen cette semaine…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={`w-full ${inputCls}`}
        />
        <button
          type="submit"
          disabled={busy || !content.trim()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? "Enregistrement…" : "Ajouter la note"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <ul className="mt-4 space-y-2">
        {notes.map((n) => (
          <li
            key={n.id}
            className="group flex items-start gap-3 rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800"
          >
            <span className="shrink-0 text-xs text-neutral-500">
              {new Date(n.note_date).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
              {n.content}
            </span>
            <button
              onClick={() => remove(n.id)}
              className="shrink-0 text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:text-red-600"
              aria-label="Supprimer la note"
            >
              <ion-icon name="trash-outline"></ion-icon>
            </button>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="text-sm text-neutral-500">Aucune note pour l'instant.</li>
        )}
      </ul>
    </section>
  );
}
