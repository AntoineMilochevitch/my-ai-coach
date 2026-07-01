import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Item {
  id: string;
  category: string;
  content: string;
}

const CATS: { key: string; label: string; icon: string }[] = [
  { key: "objectif", label: "Objectifs", icon: "flag-outline" },
  { key: "blessure", label: "Blessures / santé", icon: "medkit-outline" },
  { key: "preference", label: "Préférences", icon: "heart-outline" },
  { key: "contrainte", label: "Contraintes", icon: "time-outline" },
  { key: "autre", label: "Divers", icon: "bookmark-outline" },
];
const LABEL = Object.fromEntries(CATS.map((c) => [c.key, c.label]));

/** Panneau « Mémoire du coach » : faits durables réutilisés entre conversations. */
export default function CoachMemory() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("objectif");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("coach_memory")
      .select("id, category, content")
      .order("created_at", { ascending: true });
    setItems((data as Item[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (uid) {
      await supabase.from("coach_memory").insert({ user_id: uid, category: cat, content });
      setText("");
      await load();
    }
    setBusy(false);
  }

  async function remove(id: string) {
    setItems((xs) => xs.filter((x) => x.id !== id));
    await supabase.from("coach_memory").delete().eq("id", id);
  }

  const grouped = CATS.map((c) => ({
    ...c,
    list: items.filter((i) => (LABEL[i.category] ? i.category : "autre") === c.key),
  })).filter((g) => g.list.length);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
        <ion-icon name="bookmarks-outline" className="text-base text-green-600"></ion-icon>
        Mémoire du coach
      </h2>
      <p className="mt-1 text-xs text-neutral-400">
        Faits durables (objectifs, blessures, préférences, contraintes) que le coach réutilise d'une
        conversation à l'autre. Tu peux aussi lui dire « retiens que… » dans le chat.
      </p>

      {!loading && grouped.length > 0 && (
        <div className="mt-4 space-y-4">
          {grouped.map((g) => (
            <div key={g.key}>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
                <ion-icon name={g.icon}></ion-icon>
                {g.label}
              </h3>
              <ul className="space-y-1.5">
                {g.list.map((it) => (
                  <li
                    key={it.id}
                    className="group flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300"
                  >
                    <span className="flex-1">{it.content}</span>
                    <button
                      onClick={() => remove(it.id)}
                      className="text-neutral-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                      title="Supprimer"
                    >
                      <ion-icon name="close-outline"></ion-icon>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!loading && grouped.length === 0 && (
        <p className="mt-4 text-sm text-neutral-500">
          Aucun fait mémorisé pour l'instant.
        </p>
      )}

      {/* Ajout manuel */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {CATS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Ex. Douleur récurrente au genou droit"
          maxLength={400}
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          onClick={add}
          disabled={busy || !text.trim()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Ajouter
        </button>
      </div>
    </section>
  );
}
