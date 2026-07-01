interface Macros {
  kcal?: number | null;
  prot_g?: number | null;
  gluc_g?: number | null;
  lip_g?: number | null;
}
interface DayNeed extends Macros {
  type?: string;
  note?: string;
}
interface Meal extends Macros {
  nom?: string;
  idee?: string;
  rationale?: string;
}
interface InEffort {
  duree?: string;
  glucides?: string;
  hydratation?: string;
  exemples?: string;
}
export interface NPlan {
  resume?: string;
  besoins_journaliers?: DayNeed[];
  repas?: Meal[];
  hydratation?: string;
  autour_seances?: string;
  pendant_effort?: InEffort[];
  error?: string;
}

function macroLine(m: Macros): string {
  return [
    m.kcal != null ? `${Math.round(m.kcal)} kcal` : "",
    m.prot_g != null ? `${Math.round(m.prot_g)} g protéines` : "",
    m.gluc_g != null ? `${Math.round(m.gluc_g)} g glucides` : "",
    m.lip_g != null ? `${Math.round(m.lip_g)} g lipides` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Affichage d'un plan nutrition recommandé (besoins par type de jour + repas type). */
export default function NutritionPlan({ plan }: { plan: NPlan }) {
  if (plan.error) {
    return <p className="text-sm text-red-600">{plan.error}</p>;
  }
  return (
    <div className="space-y-4">
      {plan.resume && <p className="text-sm text-neutral-600 dark:text-neutral-400">{plan.resume}</p>}

      {plan.besoins_journaliers && plan.besoins_journaliers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            Besoins par type de jour
          </h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {plan.besoins_journaliers.map((d, i) => (
              <div
                key={i}
                className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {d.type}
                </div>
                <div className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">
                  {macroLine(d)}
                </div>
                {d.note && <p className="mt-1 text-xs text-neutral-500">{d.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.repas && plan.repas.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            Journée type
          </h3>
          <ul className="mt-2 space-y-2">
            {plan.repas.map((r, i) => (
              <li key={i} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{r.nom}</span>
                  <span className="text-xs text-neutral-500">{macroLine(r)}</span>
                </div>
                {r.idee && (
                  <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{r.idee}</p>
                )}
                {r.rationale && <p className="mt-0.5 text-xs text-neutral-500">{r.rationale}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.pendant_effort && plan.pendant_effort.length > 0 && (
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            <ion-icon name="flash-outline"></ion-icon> Ravitaillement pendant l'effort
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1 pr-4">Durée</th>
                  <th className="py-1 pr-4">Glucides</th>
                  <th className="py-1 pr-4">Hydratation</th>
                  <th className="py-1">Exemples</th>
                </tr>
              </thead>
              <tbody>
                {plan.pendant_effort.map((e, i) => (
                  <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1.5 pr-4 font-medium text-neutral-800 dark:text-neutral-200">
                      {e.duree}
                    </td>
                    <td className="py-1.5 pr-4 text-neutral-600 dark:text-neutral-400">{e.glucides}</td>
                    <td className="py-1.5 pr-4 text-neutral-600 dark:text-neutral-400">
                      {e.hydratation}
                    </td>
                    <td className="py-1.5 text-neutral-600 dark:text-neutral-400">{e.exemples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(plan.hydratation || plan.autour_seances) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {plan.hydratation && (
            <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                <ion-icon name="water-outline"></ion-icon> Hydratation
              </div>
              <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{plan.hydratation}</p>
            </div>
          )}
          {plan.autour_seances && (
            <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                <ion-icon name="stopwatch-outline"></ion-icon> Autour des séances
              </div>
              <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                {plan.autour_seances}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
