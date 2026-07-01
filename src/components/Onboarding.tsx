import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Onboarding guidé (1re connexion) : checklist à statut live des étapes de mise en
 * route. S'affiche tant que profiles.settings.onboarded n'est pas vrai. Chaque
 * étape renvoie vers l'endroit concerné et se coche automatiquement une fois faite.
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [keyOk, setKeyOk] = useState(false);
  const [garminOk, setGarminOk] = useState(false);
  const [hasActivities, setHasActivities] = useState(false);
  const [hasPlan, setHasPlan] = useState(false);

  const load = useCallback(async () => {
    const [profRes, gaRes, actsRes, plansRes] = await Promise.all([
      supabase.from("profiles").select("settings").maybeSingle(),
      supabase.from("garmin_accounts").select("status").maybeSingle(),
      supabase.from("activities").select("id", { count: "exact", head: true }),
      supabase.from("training_plans").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]);
    const s: any = profRes.data?.settings ?? {};
    if (s.onboarded) {
      setShow(false);
      setLoading(false);
      return;
    }
    const keys = s.keys ?? {};
    setKeyOk(Boolean((keys.gemini || keys.anthropic || keys.openai || s.gemini_key_set) && s.ai_model));
    setGarminOk(gaRes.data?.status === "connected");
    setHasActivities((actsRes.count ?? 0) > 0);
    setHasPlan((plansRes.count ?? 0) > 0);
    setShow(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !show) return null;

  async function finish() {
    const { data: prof } = await supabase.from("profiles").select("settings").maybeSingle();
    const { data: u } = await supabase.auth.getUser();
    await supabase
      .from("profiles")
      .update({ settings: { ...((prof?.settings as object) ?? {}), onboarded: true } })
      .eq("id", u.user?.id ?? "");
    setShow(false);
  }

  const steps = [
    {
      done: keyOk,
      title: "Configure ton IA",
      desc: "Ajoute ta clé API (Gemini, Claude ou OpenAI) et choisis un modèle.",
      cta: "Configurer",
      to: "/profile",
    },
    {
      done: garminOk,
      title: "Connecte Garmin",
      desc: "Relie ton compte Garmin Connect pour importer tes données.",
      cta: "Connecter",
      to: "/profile",
    },
    {
      done: hasActivities,
      title: "Synchronise tes données",
      desc: "Importe tes activités, métriques et sommeil depuis Garmin.",
      cta: "Synchroniser",
      to: "/profile",
    },
    {
      done: hasPlan,
      title: "Génère ton plan",
      desc: "Crée un plan d'entraînement adaptatif calibré sur ton objectif.",
      cta: "Créer un plan",
      to: "/plan",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={() => setShow(false)}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 dark:bg-neutral-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Bienvenue sur my-ai-coach 👋
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Ton coach sportif IA : suivi Garmin, analyses, plan adaptatif et nutrition. Voici
              comment démarrer ({doneCount}/{steps.length}).
            </p>
          </div>
          <button
            onClick={() => setShow(false)}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label="Fermer"
          >
            <ion-icon name="close-outline" className="text-xl"></ion-icon>
          </button>
        </div>

        <ol className="mt-4 space-y-2">
          {steps.map((st, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  st.done
                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {st.done ? <ion-icon name="checkmark-outline"></ion-icon> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-neutral-900 dark:text-neutral-100">{st.title}</div>
                <p className="text-xs text-neutral-500">{st.desc}</p>
              </div>
              {st.done ? (
                <span className="mt-0.5 shrink-0 text-xs font-medium text-green-600">Fait</span>
              ) : (
                <button
                  onClick={() => {
                    setShow(false);
                    navigate(st.to);
                  }}
                  className="mt-0.5 shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {st.cta}
                </button>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setShow(false)}
            className="text-sm text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            Plus tard
          </button>
          <button
            onClick={finish}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {doneCount === steps.length ? "Terminer" : "Ne plus afficher"}
          </button>
        </div>
      </div>
    </div>
  );
}
