import { useState } from "react";
import { supabase } from "../lib/supabase";
import Spinner from "./Spinner";

export interface ActivityLog {
  id?: string;
  activity_id: string;
  ressenti: string | null;
  fueled: boolean | null;
  intake: string | null;
  carbs_g: number | null;
  fluids_ml: number | null;
  calories: number | null;
}

const inputCls =
  "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

/** Journal post-activité : ressenti + ravitaillement (mangé/bu, quoi, valeurs). */
export default function ActivityLogModal({
  activityId,
  activityLabel,
  log,
  onClose,
  onSaved,
}: {
  activityId: string;
  activityLabel: string;
  log: ActivityLog | null;
  onClose: () => void;
  onSaved: (log: ActivityLog | null) => void;
}) {
  const [ressenti, setRessenti] = useState(log?.ressenti ?? "");
  const [fueled, setFueled] = useState(log?.fueled ?? false);
  const [intake, setIntake] = useState(log?.intake ?? "");
  const [carbs, setCarbs] = useState(log?.carbs_g != null ? String(log.carbs_g) : "");
  const [fluids, setFluids] = useState(log?.fluids_ml != null ? String(log.fluids_ml) : "");
  const [calories, setCalories] = useState(log?.calories != null ? String(log.calories) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (s: string) => (s.trim() ? Number(s) : null);

  async function save() {
    setBusy(true);
    setError(null);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      setBusy(false);
      return;
    }
    const row = {
      user_id: uid,
      activity_id: activityId,
      ressenti: ressenti.trim() || null,
      fueled,
      intake: fueled ? intake.trim() || null : null,
      carbs_g: fueled ? num(carbs) : null,
      fluids_ml: fueled ? num(fluids) : null,
      calories: fueled ? num(calories) : null,
    };
    const { data, error: e } = await supabase
      .from("activity_logs")
      .upsert(row, { onConflict: "user_id,activity_id" })
      .select("id")
      .single();
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onSaved({ ...row, id: data?.id });
  }

  async function remove() {
    setBusy(true);
    await supabase.from("activity_logs").delete().eq("activity_id", activityId);
    setBusy(false);
    onSaved(null);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-6 dark:bg-neutral-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Ressenti & ravitaillement
            </h2>
            <p className="text-xs text-neutral-500">{activityLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label="Fermer"
          >
            <ion-icon name="close-outline" className="text-xl"></ion-icon>
          </button>
        </div>

        <label className="mt-4 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Ressenti
          <textarea
            rows={2}
            value={ressenti}
            onChange={(e) => setRessenti(e.target.value)}
            placeholder="Sensations, fatigue, douleurs, météo…"
            className={inputCls}
          />
        </label>

        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={fueled}
            onChange={(e) => setFueled(e.target.checked)}
            className="h-4 w-4"
          />
          As-tu mangé / bu pendant ou autour de la séance ?
        </label>

        {fueled && (
          <div className="mt-2 space-y-2">
            <input
              value={intake}
              onChange={(e) => setIntake(e.target.value)}
              placeholder="Quoi ? ex. 1 gel + 500 ml eau + banane"
              className={inputCls}
            />
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-neutral-500">
                Glucides (g)
                <input type="number" value={carbs} onChange={(e) => setCarbs(e.target.value)} className={inputCls} />
              </label>
              <label className="text-xs text-neutral-500">
                Liquides (ml)
                <input type="number" value={fluids} onChange={(e) => setFluids(e.target.value)} className={inputCls} />
              </label>
              <label className="text-xs text-neutral-500">
                kcal
                <input type="number" value={calories} onChange={(e) => setCalories(e.target.value)} className={inputCls} />
              </label>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy ? <Spinner /> : "Enregistrer"}
          </button>
          {log && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-red-600 disabled:opacity-50 dark:border-neutral-700"
            >
              Supprimer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
