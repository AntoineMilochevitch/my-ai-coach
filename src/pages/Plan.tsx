import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";
import { generatePlan, adaptPlan, matchPlan, pushWorkout, type PlanInput } from "../lib/api";

interface MacroWeek {
  num: number;
  phase?: string;
  focus?: string;
  volume_km?: number;
  sortie_longue_km?: number;
  seances_qualite?: number;
  note?: string;
}
interface Plan {
  id: string;
  goal: string | null;
  start_date: string;
  end_date: string;
  availability: Record<string, any> | null;
  macro: { resume?: string; semaines?: MacroWeek[] } | null;
  last_adapted_at: string | null;
}
interface Step {
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
interface Workout {
  id: string;
  scheduled_date: string;
  sport: string | null;
  title: string | null;
  description: string | null;
  session_type: string | null;
  week_number: number | null;
  status: string;
  garmin_workout_id: number | null;
  target: {
    distance_km?: number | null;
    duree_min?: number | null;
    allure?: string | null;
    zone_fc?: string | null;
  } | null;
  steps: Step[] | null;
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
    return s.distanceM >= 1000 ? `${(s.distanceM / 1000).toFixed(2)} km` : `${Math.round(s.distanceM)} m`;
  if (s.endType === "time" && s.durationSec) return `${Math.round(s.durationSec / 60)} min`;
  return "";
}
function stepPace(s: Step): string {
  if (s.paceHigh || s.paceLow) return ` @ ${[s.paceHigh, s.paceLow].filter(Boolean).join("-")}/km`;
  if (s.hrZone) return ` · FC Z${s.hrZone}`;
  return "";
}
function stepLine(s: Step): string {
  return `${STEP_LABEL[s.type ?? ""] ?? s.type ?? "Étape"} ${stepEnd(s)}${stepPace(s)}`.trim();
}

/** Détail des étapes d'une séance (gère les blocs répétés "N ×"). */
function StepsList({ steps }: { steps: Step[] }) {
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

/** Semaine en cours du plan (1..numWeeks) d'après start_date (heure locale). */
function planCurrentWeek(startDate: string, numWeeks: number): number {
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - start.getTime()) / (7 * 86400000));
  return Math.min(Math.max(diff + 1, 1), Math.max(numWeeks, 1));
}

const PHASE_COLOR: Record<string, string> = {
  base: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  développement: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  developpement: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  spécifique: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  specifique: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  affûtage: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  affutage: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  récupération: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  recuperation: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const RUN_TYPES = ["easy", "long", "tempo", "interval", "recovery"];
/** Séance "course" (donc téléversable vers Garmin) : sport course/running OU type de séance de course. */
function isRunSession(w: { sport: string | null; session_type: string | null }): boolean {
  const s = (w.sport ?? "").toLowerCase();
  if (s.includes("run") || s.includes("cours")) return true;
  return RUN_TYPES.includes((w.session_type ?? "").toLowerCase());
}

const OBJECTIVES = ["Forme générale", "5 km", "10 km", "Semi-marathon", "Marathon", "Trail"];
const DAYS = [
  { n: 1, l: "Lun" },
  { n: 2, l: "Mar" },
  { n: 3, l: "Mer" },
  { n: 4, l: "Jeu" },
  { n: 5, l: "Ven" },
  { n: 6, l: "Sam" },
  { n: 7, l: "Dim" },
];
const TYPE_COLOR: Record<string, string> = {
  easy: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  recovery: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  long: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  tempo: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  interval: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  cross: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  strength: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

export default function Plan() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const pollingRef = useRef(false);
  // created_at du plan le plus récent AVANT de lancer une génération : on n'accepte
  // un plan "active" comme terminé que s'il est plus récent (évite de prendre
  // l'ancien plan encore en place tant que la nouvelle génération n'a pas démarré).
  const genBaseline = useRef<string | null>(null);

  // Formulaire
  const [mode, setMode] = useState<"weeks" | "date">("weeks");
  const [objective, setObjective] = useState("10 km");
  const [targetTime, setTargetTime] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [elevationM, setElevationM] = useState("");
  const [weeks, setWeeks] = useState(8);
  const [targetDate, setTargetDate] = useState("");
  const [preferredDays, setPreferredDays] = useState<number[]>([2, 4, 6]);
  const [maxSessionMin, setMaxSessionMin] = useState("");
  const [level, setLevel] = useState("intermédiaire");
  const [constraints, setConstraints] = useState("");

  const isForme = /forme/i.test(objective);
  const isTrail = /trail/i.test(objective);
  const isRace = !isForme && !isTrail;

  const loadWorkouts = useCallback(async (planId: string) => {
    await matchPlan().catch(() => {});
    const { data: w, error: e } = await supabase
      .from("plan_workouts")
      .select(
        "id, scheduled_date, sport, title, description, session_type, week_number, status, garmin_workout_id, target, steps",
      )
      .eq("plan_id", planId)
      .order("scheduled_date", { ascending: true });
    if (e) {
      // ex. colonne garmin_workout_id absente -> migration 0006 non appliquée
      setError(`${e.message} — as-tu appliqué la migration 0006 (garmin_workout_id) ?`);
      return;
    }
    setWorkouts(w ?? []);
  }, []);

  const pollPlan = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    const started = Date.now();
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        const { data: p } = await supabase
          .from("training_plans")
          .select("status, content, created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const isNewer =
          !genBaseline.current || !p?.created_at || p.created_at > genBaseline.current;
        if (p?.status === "active" && isNewer) {
          setGenerating(false);
          await load();
          return;
        }
        if (p?.status === "error") {
          setError((p.content as { error?: string })?.error || "Échec de la génération.");
          setGenerating(false);
          setShowForm(true);
          return;
        }
        if (Date.now() - started > 150000) {
          setError("La génération prend trop de temps. Réessaie dans un moment.");
          setGenerating(false);
          return;
        }
      }
    } finally {
      pollingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: p } = await supabase
      .from("training_plans")
      .select("id, goal, start_date, end_date, status, availability, content, macro, last_adapted_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!p) {
      setPlan(null);
      setWorkouts([]);
      setGenerating(false);
      setShowForm(true);
    } else if (p.status === "generating") {
      setGenerating(true);
      setShowForm(false);
      genBaseline.current = null; // génération déjà en cours : accepte tout "active"
      pollPlan();
    } else if (p.status === "active") {
      setPlan(p);
      setGenerating(false);
      setShowForm(false);
      await loadWorkouts(p.id);
    } else if (p.status === "error") {
      setPlan(null);
      setGenerating(false);
      setShowForm(true);
      setError((p.content as { error?: string })?.error || "La dernière génération a échoué.");
    } else {
      // archived seul -> proposer un nouveau plan
      setPlan(null);
      setShowForm(true);
    }
    setLoading(false);
  }, [loadWorkouts, pollPlan]);

  useEffect(() => {
    load();
  }, [load]);

  function buildInput(): PlanInput {
    return {
      mode,
      objective,
      preferredDays,
      level,
      constraints: constraints.trim() || undefined,
      maxSessionMin: maxSessionMin ? Number(maxSessionMin) : undefined,
      targetTime: targetTime.trim() || undefined,
      distanceKm: isTrail && distanceKm ? Number(distanceKm) : undefined,
      elevationM: isTrail && elevationM ? Number(elevationM) : undefined,
      ...(mode === "weeks" ? { weeks } : { targetDate }),
    };
  }

  async function startGeneration(input: PlanInput) {
    setGenerating(true);
    setError(null);
    setInfo(null);
    try {
      // Baseline : plan le plus récent actuel (pour distinguer le nouveau plan).
      const { data: prev } = await supabase
        .from("training_plans")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      genBaseline.current = prev?.created_at ?? "1970-01-01";
      await generatePlan(input);
      await pollPlan();
    } catch (err) {
      setError((err as Error).message);
      setGenerating(false);
    }
  }

  async function onGenerate(e: FormEvent) {
    e.preventDefault();
    if (preferredDays.length === 0) {
      setError("Sélectionne au moins un jour d'entraînement.");
      return;
    }
    await startGeneration(buildInput());
  }

  // Adapter = ré-ajuster la fenêtre de semaines à venir selon l'état de forme réel
  // (réalisé vs cible, récup, nutrition, notes). Ne régénère PAS tout le plan.
  async function onAdapt() {
    if (!plan || adapting) return;
    setAdapting(true);
    setError(null);
    setInfo(null);
    const baseline = plan.last_adapted_at ?? null;
    try {
      await adaptPlan();
      const started = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        const { data: p } = await supabase
          .from("training_plans")
          .select("last_adapted_at, content")
          .eq("id", plan.id)
          .maybeSingle();
        const adaptError = (p?.content as { adapt_error?: string } | null)?.adapt_error;
        if (p?.last_adapted_at && p.last_adapted_at !== baseline) {
          setInfo("Plan adapté à ta forme récente.");
          await load();
          break;
        }
        if (adaptError) {
          setError(adaptError);
          break;
        }
        if (Date.now() - started > 120000) {
          setError("L'adaptation prend trop de temps. Réessaie dans un moment.");
          break;
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdapting(false);
    }
  }

  async function deletePlan() {
    if (!plan) return;
    if (!window.confirm("Supprimer définitivement ce plan ?")) return;
    await supabase.from("training_plans").delete().eq("id", plan.id);
    await load();
  }

  async function toggleDone(w: Workout) {
    const next = w.status === "done" ? "planned" : "done";
    setWorkouts((ws) => ws.map((x) => (x.id === w.id ? { ...x, status: next } : x)));
    await supabase.from("plan_workouts").update({ status: next }).eq("id", w.id);
  }

  async function pushOne(w: Workout) {
    setInfo(null);
    setError(null);
    try {
      const res = await pushWorkout({ planWorkoutId: w.id });
      if (res.pushed) {
        setWorkouts((ws) =>
          ws.map((x) => (x.id === w.id ? { ...x, garmin_workout_id: 1 } : x)),
        );
        setInfo("Séance envoyée sur Garmin.");
      } else {
        setError(res.errors[0] || "Échec de l'envoi.");
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function toggleDay(n: number) {
    setPreferredDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()));
  }

  const total = workouts.length;
  const done = workouts.filter((w) => w.status === "done").length;
  const byWeek = workouts.reduce<Record<number, Workout[]>>((acc, w) => {
    const k = w.week_number ?? 0;
    (acc[k] ??= []).push(w);
    return acc;
  }, {});
  const macroWeeks = plan?.macro?.semaines ?? [];
  const currentWeek = plan ? planCurrentWeek(plan.start_date, macroWeeks.length) : 0;
  const macroByNum = new Map(macroWeeks.map((w) => [w.num, w]));
  const weekNums = macroWeeks.length
    ? macroWeeks.map((w) => w.num)
    : Object.keys(byWeek).map(Number).sort((a, b) => a - b);

  const inputCls =
    "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";
  const btnCls =
    "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";
  const ghostBtn =
    "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <Layout>
      <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Plan d'entraînement
          </h1>
          {plan && !showForm && !generating && (
            <div className="flex flex-wrap gap-2">
              <button onClick={onAdapt} disabled={adapting} className={ghostBtn}>
                {adapting ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner /> Adaptation…
                  </span>
                ) : (
                  <>
                    <ion-icon name="sync-outline" className="align-[-2px]"></ion-icon> Adapter ma semaine
                  </>
                )}
              </button>
              <button onClick={() => setShowForm(true)} disabled={adapting} className={ghostBtn}>
                Nouveau plan
              </button>
              <button onClick={deletePlan} disabled={adapting} className={`${ghostBtn} text-red-600`}>
                Supprimer
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        {info && <p className="text-sm text-green-600">{info}</p>}

        {loading && (
          <p className="flex items-center gap-2 text-sm text-neutral-500">
            <Spinner /> Chargement…
          </p>
        )}

        {/* État : génération en cours (persistant si on revient sur la page) */}
        {generating && (
          <section className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <Spinner className="h-5 w-5" />
            <div>
              <p className="font-medium text-neutral-900 dark:text-neutral-100">
                Plan en cours de génération…
              </p>
              <p className="text-sm text-neutral-500">
                Le coach construit ton plan (20-40 s). Tu peux quitter la page et revenir.
              </p>
            </div>
          </section>
        )}

        {!loading && !generating && showForm && (
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="font-medium text-neutral-900 dark:text-neutral-100">Générer un plan</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Calibré sur tes données récentes (volume, allures, VO₂max, récup) et le réalisé du plan précédent.
            </p>
            <form onSubmit={onGenerate} className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Objectif *</label>
                <select className={inputCls} value={objective} onChange={(e) => setObjective(e.target.value)}>
                  {OBJECTIVES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              {isRace && (
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium">Chrono visé *</label>
                  <input required placeholder="ex. 45:00 ou 3h30" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} className={inputCls} />
                </div>
              )}
              {isTrail && (
                <>
                  <div>
                    <label className="text-sm font-medium">Distance (km) *</label>
                    <input required type="number" min={1} placeholder="ex. 30" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Dénivelé D+ (m) *</label>
                    <input required type="number" min={0} placeholder="ex. 1500" value={elevationM} onChange={(e) => setElevationM(e.target.value)} className={inputCls} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-sm font-medium">Temps visé (optionnel)</label>
                    <input placeholder="ex. 4h00" value={targetTime} onChange={(e) => setTargetTime(e.target.value)} className={inputCls} />
                  </div>
                </>
              )}

              <div className="sm:col-span-2">
                <div className="inline-flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-700">
                  {(["weeks", "date"] as const).map((mo) => (
                    <button type="button" key={mo} onClick={() => setMode(mo)} className={`rounded-md px-3 py-1 text-sm ${mode === mo ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 dark:text-neutral-300"}`}>
                      {mo === "weeks" ? "Bloc de semaines" : "Date cible"}
                    </button>
                  ))}
                </div>
              </div>

              {mode === "weeks" ? (
                <div>
                  <label className="text-sm font-medium">Durée (semaines) *</label>
                  <input required type="number" min={1} max={16} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className={inputCls} />
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium">Date cible *</label>
                  <input type="date" required value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputCls} />
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Jours d'entraînement *</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {DAYS.map((d) => (
                    <button
                      type="button"
                      key={d.n}
                      onClick={() => toggleDay(d.n)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                        preferredDays.includes(d.n)
                          ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                          : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {d.l}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Durée max / séance (min, optionnel)</label>
                <input type="number" placeholder="ex. 90" value={maxSessionMin} onChange={(e) => setMaxSessionMin(e.target.value)} className={inputCls} />
              </div>

              <div>
                <label className="text-sm font-medium">Niveau (optionnel)</label>
                <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="débutant">Débutant</option>
                  <option value="intermédiaire">Intermédiaire</option>
                  <option value="avancé">Avancé</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Contraintes (optionnel)</label>
                <textarea rows={2} placeholder="blessures, cross-training souhaité…" value={constraints} onChange={(e) => setConstraints(e.target.value)} className={inputCls} />
              </div>

              <div className="sm:col-span-2 flex items-center gap-3">
                <button type="submit" className={btnCls}>
                  Générer le plan
                </button>
                {plan && (
                  <button type="button" onClick={() => setShowForm(false)} className={ghostBtn}>
                    Annuler
                  </button>
                )}
              </div>
            </form>
          </section>
        )}

        {!loading && plan && !showForm && !generating && (
          <>
            <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="font-medium text-neutral-900 dark:text-neutral-100">{plan.goal}</h2>
              <p className="text-sm text-neutral-500">
                {plan.start_date} → {plan.end_date}
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                <div className="h-full bg-green-500" style={{ width: total ? `${(done / total) * 100}%` : "0%" }} />
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {done}/{total} séances planifiées réalisées
                {macroWeeks.length ? ` · semaine ${currentWeek}/${macroWeeks.length}` : ""}
              </p>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-neutral-500">
                <ion-icon name="sparkles-outline" className="mt-0.5 shrink-0"></ion-icon>
                <span>
                  Plan adaptatif : les semaines à venir se détaillent au fil de ta progression
                  (auto chaque lundi, ou via « Adapter ma semaine ») selon ta forme et ton réalisé.
                  {plan.last_adapted_at &&
                    ` Dernière adaptation : ${new Date(plan.last_adapted_at).toLocaleDateString("fr-FR")}.`}
                </span>
              </p>
            </section>

            {weekNums.map((wk) => {
              const mw = macroByNum.get(wk);
              const sessions = byWeek[wk] ?? [];
              return (
                <section key={wk} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                      Semaine {wk}
                    </h3>
                    {wk === currentWeek && (
                      <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
                        en cours
                      </span>
                    )}
                    {mw?.phase && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          PHASE_COLOR[mw.phase.toLowerCase()] ??
                          "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                        }`}
                      >
                        {mw.phase}
                      </span>
                    )}
                    {(mw?.volume_km != null || mw?.seances_qualite != null) && (
                      <span className="text-xs text-neutral-500">
                        {mw?.volume_km != null ? `~${Math.round(mw.volume_km)} km` : ""}
                        {mw?.seances_qualite != null ? ` · ${mw.seances_qualite} qualité` : ""}
                      </span>
                    )}
                  </div>
                  {mw?.focus && <p className="text-xs text-neutral-500">{mw.focus}</p>}
                  {sessions.length === 0 && (
                    <p className="rounded-xl border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
                      Séances détaillées plus tard, adaptées à ta forme (auto chaque lundi ou « Adapter ma semaine »).
                    </p>
                  )}
                  {sessions.map((w) => (
                    <div key={w.id} className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                      <input type="checkbox" checked={w.status === "done"} onChange={() => toggleDone(w)} className="mt-1 h-4 w-4" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-neutral-500">
                            {new Date(w.scheduled_date).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_COLOR[w.session_type ?? ""] ?? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
                            {w.session_type}
                          </span>
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">{w.title}</span>
                          {w.status === "missed" && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-300">
                              manquée
                            </span>
                          )}
                        </div>
                        {w.target && (
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {[
                              w.target.distance_km ? `${Math.round(w.target.distance_km * 10) / 10} km` : "",
                              w.target.duree_min ? `${Math.round(w.target.duree_min)} min` : "",
                              w.target.allure ? `allure ${w.target.allure}` : "",
                              w.target.zone_fc ? `FC ${w.target.zone_fc}` : "",
                            ].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {w.description && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{w.description}</p>}
                        {w.steps && w.steps.length > 0 && <StepsList steps={w.steps} />}
                        {isRunSession(w) && (
                          <div className="mt-2">
                            {w.garmin_workout_id ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                                <ion-icon name="checkmark-circle-outline"></ion-icon> Sur Garmin
                              </span>
                            ) : (
                              <button
                                onClick={() => pushOne(w)}
                                className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                              >
                                <ion-icon name="watch-outline" className="align-[-2px]"></ion-icon> Envoyer sur Garmin
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </>
        )}
      </main>
    </Layout>
  );
}
