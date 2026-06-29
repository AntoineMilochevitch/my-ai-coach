import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { listModels, setAiConfig } from "../lib/api";
import GarminPanel from "../components/GarminPanel";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";

interface ModelOption {
  id: string;
  label: string;
}

export default function Profile() {
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [keySet, setKeySet] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [garminStatus, setGarminStatus] = useState("disconnected");
  const [lastSync, setLastSync] = useState<string | null>(null);

  const loadGarmin = useCallback(async () => {
    const { data: ga } = await supabase
      .from("garmin_accounts")
      .select("status, last_sync_at")
      .maybeSingle();
    setGarminStatus(ga?.status ?? "disconnected");
    setLastSync(ga?.last_sync_at ?? null);
  }, []);

  const fetchModels = useCallback(async (key?: string) => {
    setLoadingModels(true);
    setError(null);
    try {
      const res = await listModels(key);
      setModels(res.models);
      setKeySet(res.gemini_key_set);
      return res.models;
    } catch (err) {
      setError((err as Error).message);
      return [];
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("settings")
        .maybeSingle();
      const s: any = prof?.settings ?? {};
      if (s.ai_model) setModel(s.ai_model);
      if (s.gemini_key_set) {
        setKeySet(true);
        fetchModels(); // charge les modèles avec la clé déjà stockée
      }
    })();
    loadGarmin();
  }, [fetchModels, loadGarmin]);

  // Étape 1+2 : valider la clé puis charger les modèles.
  async function validateKey(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const list = await fetchModels(geminiKey.trim() || undefined);
    if (list.length) {
      setGeminiKey("");
      setMsg("Clé validée et modèles chargés. Choisis ton modèle ci-dessous.");
    }
  }

  // Étape 3 : choisir un modèle (persisté immédiatement).
  async function onModelChange(value: string) {
    setModel(value);
    setMsg(null);
    setError(null);
    try {
      await setAiConfig({ model: value });
      setMsg("Modèle enregistré.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";
  const btnCls =
    "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";

  return (
    <Layout>
      <main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Profil
        </h1>
        {/* Assistant IA */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
            <ion-icon name="sparkles-outline" className="text-base"></ion-icon>
            Assistant IA
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Renseigne ta clé Gemini : on récupère alors les modèles disponibles pour
            ton compte, puis tu choisis. (Claude, ChatGPT seront ajoutés plus tard.)
          </p>

          {/* 1) Clé */}
          <form onSubmit={validateKey} className="mt-4 space-y-2">
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Clé API Gemini{" "}
              {keySet && (
                <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                  définie
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder={keySet ? "•••••••• (laisser vide pour conserver)" : "AIza…"}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className={inputCls}
              />
              <button type="submit" disabled={loadingModels} className={`shrink-0 ${btnCls}`}>
                {loadingModels ? <Spinner /> : keySet ? "Recharger" : "Valider"}
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Obtiens-la sur{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                aistudio.google.com/apikey
              </a>
              . Chiffrée, jamais renvoyée au navigateur.
            </p>
          </form>

          {/* 2) Modèle */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Modèle
            </label>
            <select
              className={inputCls}
              value={model}
              disabled={models.length === 0}
              onChange={(e) => onModelChange(e.target.value)}
            >
              {models.length === 0 ? (
                <option value="">Renseigne ta clé pour charger les modèles…</option>
              ) : (
                <>
                  {!model && <option value="">— choisis un modèle —</option>}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({m.id})
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          {msg && <p className="mt-3 text-sm text-green-600">{msg}</p>}
        </section>

        {/* Garmin */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
            <ion-icon name="watch-outline" className="text-base"></ion-icon>
            Garmin Connect
          </h2>
          <div className="mt-4">
            <GarminPanel status={garminStatus} lastSync={lastSync} onSynced={loadGarmin} />
          </div>
        </section>
      </main>
    </Layout>
  );
}
