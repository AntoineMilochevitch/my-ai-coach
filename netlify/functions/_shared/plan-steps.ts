/**
 * Validation/normalisation des étapes ("steps") d'une séance produites par l'IA,
 * avant stockage et téléversement Garmin. On filtre les valeurs aberrantes, on
 * borne les nombres et on déduit endType quand il manque, pour que l'affichage et
 * le push Garmin reçoivent toujours une structure cohérente.
 */
const STEP_TYPES = new Set(["warmup", "run", "interval", "recovery", "cooldown", "rest"]);
const END_TYPES = new Set(["time", "distance", "lap"]);
const PACE = /^\d{1,2}:\d{2}$/;

interface SimpleStep {
  type: string;
  endType: string;
  durationSec?: number;
  distanceM?: number;
  paceLow?: string;
  paceHigh?: string;
  hrZone?: number;
}
export interface CleanStep extends Partial<SimpleStep> {
  kind: "step" | "repeat";
  repeatCount?: number;
  steps?: SimpleStep[];
}

function posInt(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function posNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function cleanSimple(s: any): SimpleStep {
  const type = STEP_TYPES.has(String(s?.type)) ? String(s.type) : "run";
  const durationSec = posInt(s?.durationSec);
  const distanceM = posNum(s?.distanceM);
  let endType = END_TYPES.has(String(s?.endType)) ? String(s.endType) : "";
  if (!endType) endType = durationSec ? "time" : distanceM ? "distance" : "lap";

  const out: SimpleStep = { type, endType };
  if (endType === "time" && durationSec) out.durationSec = durationSec;
  if (endType === "distance" && distanceM) out.distanceM = distanceM;
  if (PACE.test(String(s?.paceLow))) out.paceLow = String(s.paceLow);
  if (PACE.test(String(s?.paceHigh))) out.paceHigh = String(s.paceHigh);
  const hr = posInt(s?.hrZone);
  if (hr && hr >= 1 && hr <= 5) out.hrZone = hr;
  return out;
}

export function sanitizeSteps(raw: unknown): CleanStep[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CleanStep[] = [];
  for (const s of raw) {
    if (s?.kind === "repeat" && Array.isArray(s.steps)) {
      const inner = s.steps.map(cleanSimple);
      if (!inner.length) continue;
      out.push({
        kind: "repeat",
        repeatCount: clamp(posInt(s.repeatCount) ?? 1, 1, 30),
        steps: inner,
      });
    } else {
      out.push({ kind: "step", ...cleanSimple(s) });
    }
  }
  return out.length ? out : null;
}
