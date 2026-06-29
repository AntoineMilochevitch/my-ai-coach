import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import { supabase } from "../lib/supabase";
import { aiAnalyze } from "../lib/api";
import Spinner from "./Spinner";

/** Section « Coach IA » : génère et affiche une analyse Gemini de la période. */
export default function CoachAnalysis({ days }: { days: number }) {
  const [content, setContent] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    const { data } = await supabase
      .from("ai_analyses")
      .select("content_md, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setContent(data.content_md);
      setCreatedAt(data.created_at);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await aiAnalyze(days);
      setContent(res.content_md);
      setCreatedAt(res.created_at);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium text-neutral-900 dark:text-neutral-100">Coach IA</h2>
          {createdAt && (
            <p className="text-xs text-neutral-500">
              Dernière analyse : {new Date(createdAt).toLocaleString("fr-FR")}
            </p>
          )}
        </div>
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> Analyse en cours…
            </span>
          ) : content ? (
            "Régénérer"
          ) : (
            "Générer une analyse"
          )}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4">
        {busy ? (
          <p className="flex items-center gap-2 text-sm text-neutral-500">
            <Spinner /> Le coach analyse tes données…
          </p>
        ) : content ? (
          <div className="markdown text-neutral-700 dark:text-neutral-300">
            <Markdown>{content}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            Aucune analyse pour l'instant. Clique sur « Générer une analyse » pour que le
            coach étudie tes données récentes.
          </p>
        )}
      </div>
    </section>
  );
}
