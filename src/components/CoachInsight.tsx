import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import { supabase } from "../lib/supabase";
import { coachInsightBackground } from "../lib/api";
import Spinner from "./Spinner";

const STALE_MS = 20 * 3600 * 1000; // 20 h : on ne régénère qu'au-delà (économie d'appels IA)

/** Carte « Message du coach » (proactif) : bilan de la dernière séance + alerte + conseil. */
export default function CoachInsight() {
  const [content, setContent] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasData, setHasData] = useState<boolean | null>(null);

  const generate = useCallback(async (manual: boolean) => {
    setBusy(true);
    if (manual) setError(null);
    try {
      const { data: prev } = await supabase
        .from("coach_insights")
        .select("created_at")
        .maybeSingle();
      const baseline = prev?.created_at ?? "1970-01-01";
      await coachInsightBackground();
      const start = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        const { data } = await supabase
          .from("coach_insights")
          .select("content_md, created_at")
          .maybeSingle();
        if (data && data.created_at > baseline) {
          setContent(data.content_md);
          setCreatedAt(data.created_at);
          break;
        }
        if (Date.now() - start > 70000) {
          if (manual) setError("Le coach met trop de temps. Réessaie dans un moment.");
          break;
        }
      }
    } catch (e) {
      if (manual) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [insRes, actsRes] = await Promise.all([
        supabase.from("coach_insights").select("content_md, created_at").maybeSingle(),
        supabase.from("activities").select("id", { count: "exact", head: true }),
      ]);
      const acts = (actsRes.count ?? 0) > 0;
      setHasData(acts);
      const ins = insRes.data;
      if (ins) {
        setContent(ins.content_md);
        setCreatedAt(ins.created_at);
      }
      const stale = !ins || Date.now() - new Date(ins.created_at).getTime() > STALE_MS;
      if (acts && stale) generate(false); // auto seulement si données ET périmé
    })();
  }, [generate]);

  // Masqué tant qu'il n'y a ni données ni message.
  if (hasData === false && !content && !busy) return null;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-gradient-to-br from-white to-neutral-50 p-6 dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
          <ion-icon
            name="chatbubble-ellipses-outline"
            className="text-base text-green-600"
          ></ion-icon>
          Message de ton coach
        </h2>
        <div className="flex items-center gap-3">
          {createdAt && !busy && (
            <span className="text-xs text-neutral-400">
              {new Date(createdAt).toLocaleDateString("fr-FR")}
            </span>
          )}
          <button
            onClick={() => generate(true)}
            disabled={busy}
            className="text-xs text-neutral-500 underline hover:text-neutral-800 disabled:opacity-50 dark:hover:text-neutral-200"
          >
            {busy ? "…" : "Actualiser"}
          </button>
        </div>
      </div>
      <div className="mt-3">
        {busy && !content ? (
          <p className="flex items-center gap-2 text-sm text-neutral-500">
            <Spinner /> Le coach prépare ton message…
          </p>
        ) : content ? (
          <div className="markdown text-sm text-neutral-700 dark:text-neutral-300">
            <Markdown>{content}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            Synchronise ton Garmin pour recevoir les conseils de ton coach.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}
