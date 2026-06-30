/**
 * Construction d'un workout "running" structuré au format Garmin Connect, et
 * envoi (création + planification au calendrier). Partagé entre le téléversement
 * des séances de plan (garmin-push-workout) et la création de séance depuis le
 * chat (create-workout).
 * Référence du format : python-garminconnect/workout.py.
 */
import { connectApiPost } from "./auth.ts";

export interface Target {
  distance_km?: number | null;
  duree_min?: number | null;
  allure?: string | null;
  zone_fc?: string | null;
}
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

const RUNNING = { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 };
const NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 };
const STEP_TYPES: Record<string, unknown> = {
  warmup: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 },
  cooldown: { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 },
  interval: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
  recovery: { stepTypeId: 4, stepTypeKey: "recovery", displayOrder: 4 },
  run: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
  rest: { stepTypeId: 5, stepTypeKey: "rest", displayOrder: 5 },
};

/** "m:ss" (min/km) -> vitesse en m/s (pour les cibles d'allure Garmin). */
function paceToSpeed(p?: string | null): number | null {
  if (!p) return null;
  const m = /^(\d+):(\d{1,2})$/.exec(String(p).trim());
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return sec > 0 ? 1000 / sec : null;
}

function endConditionOf(s: Step): { ec: Record<string, unknown>; val: number; secs: number } {
  if (s.endType === "distance" && s.distanceM) {
    return {
      ec: { conditionTypeId: 3, conditionTypeKey: "distance", displayOrder: 3, displayable: true },
      val: Math.round(s.distanceM),
      secs: Math.round((s.distanceM / 1000) * 5 * 60),
    };
  }
  if (s.endType === "time" && s.durationSec) {
    return {
      ec: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
      val: Math.round(s.durationSec),
      secs: Math.round(s.durationSec),
    };
  }
  return {
    ec: { conditionTypeId: 1, conditionTypeKey: "lap.button", displayOrder: 1, displayable: true },
    val: 0,
    secs: 0,
  };
}

function targetOf(s: Step): Record<string, unknown> {
  const lo = paceToSpeed(s.paceLow);
  const hi = paceToSpeed(s.paceHigh);
  if (lo || hi) {
    const a = lo ?? (hi as number);
    const b = hi ?? (lo as number);
    return {
      targetType: { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone", displayOrder: 6 },
      targetValueOne: +Math.min(a, b).toFixed(3),
      targetValueTwo: +Math.max(a, b).toFixed(3),
    };
  }
  if (s.hrZone) {
    return {
      targetType: { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone", displayOrder: 4 },
      zoneNumber: s.hrZone,
    };
  }
  return { targetType: NO_TARGET };
}

function execStep(s: Step, order: number): { dto: Record<string, unknown>; secs: number } {
  const { ec, val, secs } = endConditionOf(s);
  return {
    dto: {
      type: "ExecutableStepDTO",
      stepOrder: order,
      stepType: STEP_TYPES[s.type ?? "run"] ?? STEP_TYPES.run,
      endCondition: ec,
      endConditionValue: val,
      ...targetOf(s),
    },
    secs,
  };
}

function buildFromSteps(steps: Step[]): { dtos: Record<string, unknown>[]; secs: number } {
  const dtos: Record<string, unknown>[] = [];
  let order = 1;
  let secs = 0;
  for (const s of steps) {
    if (s.kind === "repeat" && Array.isArray(s.steps) && s.steps.length) {
      const groupOrder = order++;
      let groupSecs = 0;
      const inner = s.steps.map((is) => {
        const r = execStep(is, order++);
        groupSecs += r.secs;
        return r.dto;
      });
      const reps = Math.max(1, Math.round(s.repeatCount ?? 1));
      secs += groupSecs * reps;
      dtos.push({
        type: "RepeatGroupDTO",
        stepOrder: groupOrder,
        stepType: { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 },
        numberOfIterations: reps,
        workoutSteps: inner,
        endCondition: { conditionTypeId: 7, conditionTypeKey: "iterations", displayOrder: 7, displayable: false },
        endConditionValue: reps,
        smartRepeat: false,
      });
    } else {
      const r = execStep(s, order++);
      secs += r.secs;
      dtos.push(r.dto);
    }
  }
  return { dtos, secs };
}

export function buildRunningWorkout(
  title: string,
  description: string,
  target: Target | null,
  steps: Step[] | null,
): Record<string, unknown> | null {
  let workoutSteps: Record<string, unknown>[];
  let est: number;

  if (Array.isArray(steps) && steps.length) {
    const built = buildFromSteps(steps);
    if (!built.dtos.length) return null;
    workoutSteps = built.dtos;
    est = built.secs || 1800;
  } else {
    // Repli : un seul palier depuis la cible (séances sans étapes détaillées).
    const single = endConditionOf({
      endType: target?.distance_km ? "distance" : "time",
      distanceM: target?.distance_km ? target.distance_km * 1000 : null,
      durationSec: target?.duree_min ? target.duree_min * 60 : null,
    });
    if (single.val === 0) return null;
    workoutSteps = [
      {
        type: "ExecutableStepDTO",
        stepOrder: 1,
        stepType: STEP_TYPES.run,
        endCondition: single.ec,
        endConditionValue: single.val,
        targetType: NO_TARGET,
      },
    ];
    est = single.secs || 1800;
  }

  return {
    workoutName: (title || "Séance").slice(0, 80),
    description: (description || "").slice(0, 1000),
    sportType: RUNNING,
    estimatedDurationInSecs: est,
    workoutSegments: [{ segmentOrder: 1, sportType: RUNNING, workoutSteps }],
  };
}

/** Crée le workout dans Garmin et le planifie à la date donnée. Renvoie l'id Garmin. */
export async function pushRunningWorkout(
  token: string,
  payload: Record<string, unknown>,
  dateIso: string,
): Promise<number | null> {
  const created = await connectApiPost<{ workoutId: number }>(
    token,
    "/workout-service/workout",
    payload,
  );
  if (!created?.workoutId) return null;
  await connectApiPost(token, `/workout-service/schedule/${created.workoutId}`, { date: dateIso });
  return created.workoutId;
}
