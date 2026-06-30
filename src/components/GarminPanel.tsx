import { useState, type FormEvent } from "react";
import { garminLogin, garminMfa, garminSync, indexRagAll } from "../lib/api";

type Step = "connected" | "form" | "mfa" | "syncing" | "done";

/** Contenu du popup de gestion Garmin (connexion + (re)synchro). */
export default function GarminPanel({
  status,
  lastSync,
  onSynced,
}: {
  status: string;
  lastSync: string | null;
  onSynced: () => void;
}) {
  const [step, setStep] = useState<Step>(status === "connected" ? "connected" : "form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [mfaMethod, setMfaMethod] = useState("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSync() {
    setError(null);
    setStep("syncing");
    try {
      await garminSync();
      onSynced();
      setStep("done");
      // Indexe les nouvelles données pour le RAG du chat (best-effort, non bloquant).
      indexRagAll().catch(() => {});
    } catch (err) {
      setError((err as Error).message);
      setStep(status === "connected" ? "connected" : "form");
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await garminLogin(email, password);
      setPassword("");
      if (res.status === "mfa_required") {
        setSessionId(res.sessionId);
        setMfaMethod(res.mfaMethod);
        setStep("mfa");
      } else {
        await runSync();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onMfa(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await garminMfa(sessionId, code.trim());
      setCode("");
      await runSync();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";
  const btnCls =
    "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";
  const linkCls = "text-sm text-neutral-500 underline-offset-2 hover:underline";

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {step === "connected" && (
        <>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            ✅ Compte Garmin connecté.
            {lastSync && (
              <>
                {" "}
                Dernière synchro : {new Date(lastSync).toLocaleString("fr-FR")}.
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button onClick={runSync} className={btnCls}>
              Resynchroniser maintenant
            </button>
            <button onClick={() => setStep("form")} className={linkCls}>
              Reconnecter un autre compte
            </button>
          </div>
        </>
      )}

      {step === "form" && (
        <form onSubmit={onLogin} className="space-y-3">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Identifiants Garmin Connect (échangés contre un jeton sécurisé, jamais stockés).
          </p>
          <input
            type="email"
            required
            placeholder="Email Garmin"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
          <input
            type="password"
            required
            placeholder="Mot de passe Garmin"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
          <button type="submit" disabled={busy} className={btnCls}>
            {busy ? "Connexion…" : "Connecter mon Garmin"}
          </button>
        </form>
      )}

      {step === "mfa" && (
        <form onSubmit={onMfa} className="space-y-3">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Code de vérification ({mfaMethod}) reçu de Garmin :
          </p>
          <input
            inputMode="numeric"
            required
            placeholder="Code MFA"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputCls}
          />
          <button type="submit" disabled={busy} className={btnCls}>
            {busy ? "Vérification…" : "Valider le code"}
          </button>
        </form>
      )}

      {step === "syncing" && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Synchronisation des données Garmin en cours…
        </p>
      )}

      {step === "done" && (
        <p className="text-sm text-green-600">
          ✅ Synchronisé. Tu peux fermer cette fenêtre.
        </p>
      )}
    </div>
  );
}
