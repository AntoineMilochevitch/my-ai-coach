/** Détail des étapes d'une séance (gère les blocs répétés « N × »). Partagé
 * entre la liste du plan et la vue calendrier. */

export interface Step {
  kind?: string;
  type?: string;
  endType?: string;
  durationSec?: number | null;
  distanceM?: number | null;
  paceLow?: string | null;
  paceHigh?: string | null;
  hrZone?: number | null;
  repeatCount?: number | null;
  steps?: Step[] | null;
}

const STEP_LABEL: Record<string, string> = {
  warmup: "Échauffement",
  run: "Footing",
  interval: "Intervalle",
  recovery: "Récup",
  cooldown: "Retour au calme",
  rest: "Repos",
};

function stepEnd(s: Step): string {
  if (s.endType === "distance" && s.distanceM)
    return s.distanceM >= 1000
      ? `${(s.distanceM / 1000).toFixed(2)} km`
      : `${Math.round(s.distanceM)} m`;
  if (s.endType === "time" && s.durationSec) return `${Math.round(s.durationSec / 60)} min`;
  return "";
}
function stepPace(s: Step): string {
  if (s.paceHigh || s.paceLow) return ` @ ${[s.paceHigh, s.paceLow].filter(Boolean).join("-")}/km`;
  if (s.hrZone) return ` · FC Z${s.hrZone}`;
  return "";
}
export function stepLine(s: Step): string {
  return `${STEP_LABEL[s.type ?? ""] ?? s.type ?? "Étape"} ${stepEnd(s)}${stepPace(s)}`.trim();
}

export default function StepsList({ steps }: { steps: Step[] }) {
  return (
    <ul className="mt-2 space-y-0.5 border-l-2 border-neutral-200 pl-3 text-xs text-neutral-500 dark:border-neutral-700">
      {steps.map((s, i) =>
        s.kind === "repeat" && Array.isArray(s.steps) ? (
          <li key={i}>
            <span className="font-medium text-neutral-600 dark:text-neutral-400">
              {Math.max(1, Math.round(s.repeatCount ?? 1))} ×
            </span>
            <ul className="ml-3 list-disc">
              {s.steps.map((sub, j) => (
                <li key={j}>{stepLine(sub)}</li>
              ))}
            </ul>
          </li>
        ) : (
          <li key={i}>{stepLine(s)}</li>
        ),
      )}
    </ul>
  );
}
