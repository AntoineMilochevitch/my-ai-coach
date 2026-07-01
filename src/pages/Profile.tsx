import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { listModels, setAiConfig, type AiProvider } from "../lib/api";
import GarminPanel from "../components/GarminPanel";
import UsagePanel from "../components/UsagePanel";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";

interface ModelOption {
  id: string;
  label: string;
}

const PROVIDERS: { id: AiProvider; label: string; placeholder: string; keyUrl: string }[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    placeholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    placeholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    placeholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
];

export default function Profile() {
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [apiKey, setApiKey] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [garminStatus, setGarminStatus] = useState("disconnected");
  const [lastSync, setLastSync] = useState<string | null>(null);

  const meta = PROVIDERS.find((p) => p.id === provider)!;
  const keySet = Boolean(keys[provider]);

  const loadGarmin = useCallback(async () => {
    const { data: ga } = await supabase
      .from("garmin_accounts")
      .select("status, last_sync_at")
      .maybeSingle();
    setGarminStatus(ga?.status ?? "disconnected");
    setLastSync(ga?.last_sync_at ?? null);
  }, []);

  const fetchModels = useCallback(async (prov: AiProvider, key?: string) => {
    setLoadingModels(true);
    setError(null);
    try {
      const res = await listModels(prov, key);
      setModels(res.models);
      setKeys((k) => ({ ...k, [prov]: true }));
      return res.models;
    } catch (err) {
      setError((err as Error).message);
      setModels([]);
      return [];
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: prof } = await supabase.from("profiles").select("settings").maybeSingle();
      const s: any = prof?.settings ?? {};
      const prov: AiProvider = ["gemini", "anthropic", "openai"].includes(s.ai_provider)
        ? s.ai_provider
        : "gemini";
      const ks: Record<string, boolean> = s.keys ?? (s.gemini_key_set ? { gemini: true } : {});
      setProvider(prov);
      setKeys(ks);
      if (s.ai_model) setModel(s.ai_model);
      if (ks[prov]) fetchModels(prov); // modèles avec la clé déjà stockée
    })();
    loadGarmin();
  }, [fetchModels, loadGarmin]);

  async function onProviderChange(prov: AiProvider) {
    setProvider(prov);
    setApiKey("");
    setModels([]);
    setModel("");
    setMsg(null);
    setError(null);
    await setAiConfig({ provider: prov }).catch(() => {});
    if (keys[prov]) fetchModels(prov);
  }

  // Valider la clé puis charger les modèles (la Function la chiffre et la stocke).
  async function validateKey(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const list = await fetchModels(provider, apiKey.trim() || undefined);
    if (list.length) {
      setApiKey("");
      setMsg("Clé validée et modèles chargés. Choisis ton modèle ci-dessous.");
    }
  }

  // Choisir un modèle (persisté immédiatement avec le provider).
  async function onModelChange(value: string) {
    setModel(value);
    setMsg(null);
    setError(null);
    try {
      await setAiConfig({ provider, model: value });
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
            Choisis ton fournisseur, renseigne ta clé API : on récupère les modèles
            disponibles, puis tu sélectionnes celui à utiliser.
          </p>

          {/* 0) Fournisseur */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Fournisseur
            </label>
            <div className="mt-1 inline-flex flex-wrap gap-1.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onProviderChange(p.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    provider === p.id
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                      : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {p.label}
                  {keys[p.id] && " ✓"}
                </button>
              ))}
            </div>
          </div>

          {/* 1) Clé */}
          <form onSubmit={validateKey} className="mt-4 space-y-2">
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Clé API {meta.label}{" "}
              {keySet && (
                <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                  définie
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder={keySet ? "•••••••• (laisser vide pour conserver)" : meta.placeholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className={inputCls}
              />
              <button type="submit" disabled={loadingModels} className={`shrink-0 ${btnCls}`}>
                {loadingModels ? <Spinner /> : keySet ? "Recharger" : "Valider"}
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Obtiens-la sur{" "}
              <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="underline">
                {meta.keyUrl.replace(/^https:\/\//, "")}
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
                  {!models.some((m) => m.id === model) && (
                    <option value="">— choisis un modèle —</option>
                  )}
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

        {/* Consommation IA */}
        <UsagePanel />

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
