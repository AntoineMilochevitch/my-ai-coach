/**
 * Function (BACKGROUND) : generate-plan-background — génère un plan d'entraînement
 * personnalisé via le provider IA configuré. Les fonctions `-background` renvoient
 * 202 immédiatement et tournent jusqu'à 15 min : on contourne ainsi le timeout
 * 10 s des fonctions synchrones (génération IA longue).
 *
 * Le plan est généré PAR BLOCS de semaines (≤ BLOCK_WEEKS) pour borner la taille
 * de chaque réponse JSON et éviter la troncature (MAX_TOKENS). La progression est
 * maintenue en passant au modèle un résumé des semaines déjà générées.
 *
 * Cycle d'état dans training_plans : "generating" -> "active" | "error".
 */
import { requireUser } from "./_shared/supabase.ts";
import { getLlm, MaxTokensError, type LlmClient } from "./_shared/llm/index.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { checkQuota, recordUsage } from "./_shared/usage.ts";
import { upcomingMondayUtc, isoDateUtc } from "./_shared/dates.ts";
import { sanitizeSteps } from "./_shared/plan-steps.ts";

const BLOCK_WEEKS = 4;

const SYSTEM = `# RÔLE
Tu es un coach d'endurance expert, spécialisé course à pied.
Tu construis un plan d'entraînement STRUCTURÉ, PROGRESSIF et RÉALISTE, calibré sur
les données réelles de l'athlète. Principes :
- Progressivité (hausse de volume hebdo ~10% max), alternance charge/récup.
- Répartition ~80% facile / 20% intensité ; au moins 1 jour de repos.
- Calibre les allures cibles sur le chrono visé, les allures et la VO₂max de l'athlète.
- VARIÉTÉ OBLIGATOIRE : chaque semaine mélange des footings faciles, UNE sortie longue,
  et AU MOINS UNE séance de qualité (tempo/seuil OU intervalles/VO2) avec des allures
  cibles CHIFFRÉES (paceLow/paceHigh) dérivées de l'objectif. Ne propose jamais que des footings.
- Respecte le nombre de séances/semaine et la durée max par séance demandés.
- Si une date d'objectif est donnée : inclure un affûtage les derniers jours.
- jour = entier 1..7 (1=lundi … 7=dimanche). type ∈ {easy, long, tempo, interval,
  recovery, rest, cross, strength}. Renforcement/cross-training en complément, optionnels.
- On te demandera un SOUS-ENSEMBLE de semaines à la fois : respecte la numérotation
  imposée et assure la CONTINUITÉ avec les semaines déjà générées (résumé fourni).

DÉTAILLE CHAQUE SÉANCE EN ÉTAPES ("steps") cohérentes avec la description :
- chaque step a kind = "step" (étape simple) ou "repeat" (bloc répété).
- step simple : type ∈ {warmup, run, interval, recovery, cooldown}, endType ∈
  {time, distance, lap}, + durationSec (si time) OU distanceM (si distance),
  + allures cibles paceLow/paceHigh en min/km (ex "5:15"/"5:00") quand pertinent,
  ou hrZone (1-5).
- bloc "repeat" : repeatCount + steps[] (les sous-étapes répétées, ex. interval+recovery).
Exemple "footing + 5x100m" : [warmup time, run time/distance, repeat{count:5, steps:[interval distance 100m allure rapide, recovery time]}, cooldown time].

SOIS CONCIS pour limiter la taille : "description" = 1 phrase COURTE (≤120 caractères),
le détail précis vit dans "steps". "resume" = 2 phrases max. "focus" = quelques mots.

Réponds UNIQUEMENT via le schéma JSON imposé (aucun texte hors JSON).`;

const STEP_PROPS = {
  type: { type: "STRING" }, // warmup|run|interval|recovery|cooldown
  endType: { type: "STRING" }, // time|distance|lap
  durationSec: { type: "INTEGER" },
  distanceM: { type: "NUMBER" },
  paceLow: { type: "STRING" }, // allure la plus LENTE, ex "5:15"
  paceHigh: { type: "STRING" }, // allure la plus RAPIDE, ex "5:00"
  hrZone: { type: "INTEGER" },
};

const SEANCE = {
  type: "OBJECT",
  properties: {
    jour: { type: "INTEGER" },
    sport: { type: "STRING" },
    type: { type: "STRING" },
    titre: { type: "STRING" },
    description: { type: "STRING" },
    distance_km: { type: "NUMBER" },
    duree_min: { type: "INTEGER" },
    allure: { type: "STRING" },
    zone_fc: { type: "STRING" },
    steps: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING" }, // "step" | "repeat"
          ...STEP_PROPS,
          repeatCount: { type: "INTEGER" }, // si kind=repeat
          steps: {
            type: "ARRAY", // sous-étapes répétées (1 niveau)
            items: { type: "OBJECT", properties: STEP_PROPS, required: ["type", "endType"] },
          },
        },
        required: ["kind"],
      },
    },
  },
  required: ["jour", "sport", "type", "titre", "description", "steps"],
};

const WEEK = {
  type: "OBJECT",
  properties: {
    num: { type: "INTEGER" },
    focus: { type: "STRING" },
    seances: { type: "ARRAY", items: SEANCE },
  },
  required: ["num", "focus", "seances"],
};

const SCHEMA_BLOCK = {
  type: "OBJECT",
  properties: {
    resume: { type: "STRING" },
    semaines: { type: "ARRAY", items: WEEK },
  },
  required: ["semaines"],
};

interface Week {
  num: number;
  focus?: string;
  seances?: any[];
}

/** Génère un bloc de semaines [from..to] ; scinde en deux en cas de troncature. */
async function generateBlock(
  llm: LlmClient,
  baseUserText: string,
  from: number,
  to: number,
  priorSummary: string,
  totalUsage: { in: number; out: number },
  wantResume: boolean,
): Promise<{ weeks: Week[]; resume: string }> {
  const userText =
    `${baseUserText}\n\nGénère UNIQUEMENT les semaines ${from} à ${to} (numérotées ainsi). ` +
    (priorSummary
      ? `Continuité avec les semaines déjà construites :\n${priorSummary}\n`
      : "") +
    (wantResume ? `Inclure aussi un court "resume" global du plan complet.` : `Le champ "resume" peut rester vide.`);

  try {
    const { data, usage } = await llm.generateJSON<{ resume?: string; semaines?: Week[] }>(
      SYSTEM,
      userText,
      SCHEMA_BLOCK,
      { maxOutputTokens: 12288, thinkingBudget: 2048, temperature: 0.5 },
    );
    totalUsage.in += usage.in;
    totalUsage.out += usage.out;
    return { weeks: data.semaines ?? [], resume: data.resume ?? "" };
  } catch (e) {
    // Troncature : on scinde le bloc et on réessaie (jusqu'à 1 semaine par appel).
    if (e instanceof MaxTokensError && to > from) {
      const mid = Math.floor((from + to) / 2);
      const a = await generateBlock(llm, baseUserText, from, mid, priorSummary, totalUsage, wantResume);
      const sumA =
        priorSummary +
        a.weeks.map((w) => `Semaine ${w.num}: ${w.focus ?? ""}`).join("\n") +
        "\n";
      const b = await generateBlock(llm, baseUserText, mid + 1, to, sumA, totalUsage, false);
      return { weeks: [...a.weeks, ...b.weeks], resume: a.resume || b.resume };
    }
    throw e;
  }
}

export default async (req: Request): Promise<Response> => {
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  try {
    ctx = await requireUser(req);
  } catch {
    return new Response("", { status: 202 });
  }
  const { user, sb } = ctx;
  const body = await req.json().catch(() => ({}));

  // Stats du plan actif précédent (pour que le coach adapte selon le réalisé).
  let priorStats: { total: number; done: number; missed: number } | null = null;
  {
    const { data: prior } = await sb
      .from("training_plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (prior) {
      const { data: pw } = await sb
        .from("plan_workouts")
        .select("status")
        .eq("plan_id", prior.id);
      priorStats = {
        total: (pw ?? []).length,
        done: (pw ?? []).filter((x) => x.status === "done").length,
        missed: (pw ?? []).filter((x) => x.status === "missed").length,
      };
    }
  }

  // Nettoie une éventuelle génération bloquée, archive l'actif, crée la ligne "generating".
  await sb.from("training_plans").delete().eq("user_id", user.id).eq("status", "generating");
  await sb
    .from("training_plans")
    .update({ status: "archived" })
    .eq("user_id", user.id)
    .eq("status", "active");
  const { data: gen } = await sb
    .from("training_plans")
    .insert({ user_id: user.id, goal: "(génération…)", status: "generating", content: {} })
    .select("id")
    .single();
  const planId = gen?.id;

  try {
    await checkQuota(sb, user.id, "plan");
    const cfg = await loadAiConfig(sb, user);
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    const mode = body.mode === "date" ? "date" : "weeks";
    const objective = String(body.objective || "Forme générale");
    const sessionsPerWeek = Math.min(Math.max(Number(body.sessionsPerWeek) || 4, 2), 7);
    const maxSessionMin = Number(body.maxSessionMin) || null;
    const level = String(body.level || "intermédiaire");
    const constraints = String(body.constraints || "").slice(0, 1000);
    const preferredDays: number[] = Array.isArray(body.preferredDays)
      ? body.preferredDays.map((d: any) => Number(d)).filter((d: number) => d >= 1 && d <= 7)
      : [];
    const perWeek = preferredDays.length || sessionsPerWeek;
    const targetTime = String(body.targetTime || "").trim().slice(0, 40);
    const distanceKm = body.distanceKm != null ? Number(body.distanceKm) : null;
    const elevationM = body.elevationM != null ? Number(body.elevationM) : null;

    const isForme = /forme/i.test(objective);
    const isTrail = /trail/i.test(objective);
    const isRace = !isForme && !isTrail;
    if (isTrail && (!distanceKm || !elevationM))
      throw new Error("Pour le trail, distance et dénivelé (D+) sont requis.");
    if (isRace && !targetTime) throw new Error("Indique un chrono visé pour cet objectif.");

    let goalLabel = objective;
    if (isTrail)
      goalLabel = `Trail ${distanceKm} km / ${elevationM} m D+${targetTime ? ` en ${targetTime}` : ""}`;
    else if (isRace && targetTime) goalLabel = `${objective} en ${targetTime}`;

    const start = upcomingMondayUtc(cfg.timezone);
    let numWeeks: number;
    let targetDate: string | null = null;
    if (mode === "date") {
      targetDate = String(body.targetDate || "");
      const t = new Date(`${targetDate}T00:00:00Z`);
      if (Number.isNaN(t.getTime())) throw new Error("Date cible invalide.");
      numWeeks = Math.ceil((t.getTime() - start.getTime()) / (7 * 86400000));
    } else {
      numWeeks = Number(body.weeks) || 8;
    }
    numWeeks = Math.min(Math.max(numWeeks, 1), 16);

    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const [actsRes, metricsRes] = await Promise.all([
      sb
        .from("activities")
        .select("activity_type, start_time, distance_m, duration_s, avg_hr, avg_pace_s_per_km")
        .eq("user_id", user.id)
        .gte("start_time", since)
        .order("start_time", { ascending: false })
        .limit(80),
      sb
        .from("daily_metrics")
        .select("resting_hr, vo2max, vo2max_source")
        .eq("user_id", user.id)
        .order("metric_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const athlete = {
      objectif: goalLabel,
      objectif_type: objective,
      chrono_vise: targetTime || null,
      distance_km: distanceKm,
      denivele_m: elevationM,
      niveau: level,
      semaines: numWeeks,
      seances_par_semaine: perWeek,
      jours_preferes: preferredDays,
      plan_precedent: priorStats,
      duree_max_min: maxSessionMin,
      contraintes: constraints,
      vo2max: metricsRes.data?.vo2max ?? null,
      vo2max_source: metricsRes.data?.vo2max_source ?? null,
      fc_repos: metricsRes.data?.resting_hr ?? null,
      activites_recentes: actsRes.data ?? [],
    };

    const daysClause = preferredDays.length
      ? `Place les séances UNIQUEMENT sur ces jours (1=lundi … 7=dimanche) : [${preferredDays.join(", ")}]. `
      : "";
    const adaptClause = priorStats
      ? `Adapte le plan selon le plan précédent (${priorStats.done} séances réalisées, ${priorStats.missed} manquées) et les performances récentes. `
      : "";
    const baseUserText =
      `Plan de ${numWeeks} semaine(s) au total, ${perWeek} séance(s)/semaine, ` +
      `objectif "${goalLabel}"${targetDate ? `, date cible ${targetDate}` : ""}. ` +
      daysClause +
      adaptClause +
      `Calibre les allures/efforts sur le chrono visé et les données. ` +
      `Données de l'athlète (JSON) :\n\n\`\`\`json\n${JSON.stringify(athlete, null, 2)}\n\`\`\``;

    // --- Génération PAR BLOCS de semaines ---
    const totalUsage = { in: 0, out: 0 };
    const allWeeks: Week[] = [];
    let resume = "";
    let priorSummary = "";
    for (let from = 1; from <= numWeeks; from += BLOCK_WEEKS) {
      const to = Math.min(from + BLOCK_WEEKS - 1, numWeeks);
      const block = await generateBlock(
        llm,
        baseUserText,
        from,
        to,
        priorSummary,
        totalUsage,
        from === 1,
      );
      allWeeks.push(...block.weeks);
      if (from === 1 && block.resume) resume = block.resume;
      priorSummary +=
        block.weeks.map((w) => `Semaine ${w.num}: ${w.focus ?? ""}`).join("\n") + "\n";
    }
    await recordUsage(sb, user.id, "plan", totalUsage);
    if (!allWeeks.length) throw new Error("Le modèle n'a renvoyé aucune semaine exploitable.");

    const rows: any[] = [];
    let maxDate = start;
    for (const week of allWeeks) {
      const wnum = Number(week.num) || 1;
      for (const s of week.seances ?? []) {
        const jour = Math.min(Math.max(Number(s.jour) || 1, 1), 7);
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + (wnum - 1) * 7 + (jour - 1));
        if (date > maxDate) maxDate = date;
        if (s.type === "rest") continue;
        rows.push({
          plan_id: planId,
          user_id: user.id,
          scheduled_date: isoDateUtc(date),
          sport: String(s.sport || "running"),
          title: String(s.titre || s.type || "Séance"),
          description: String(s.description || ""),
          session_type: String(s.type || "easy"),
          week_number: wnum,
          target: {
            distance_km: s.distance_km ?? null,
            duree_min: s.duree_min ?? null,
            allure: s.allure ?? null,
            zone_fc: s.zone_fc ?? null,
          },
          steps: sanitizeSteps(s.steps),
          status: "planned",
        });
      }
    }

    if (rows.length) {
      const { error: wErr } = await sb.from("plan_workouts").insert(rows);
      if (wErr) throw new Error(wErr.message);
    }

    await sb
      .from("training_plans")
      .update({
        goal: goalLabel,
        level,
        availability: {
          objective,
          sessionsPerWeek: perWeek,
          preferredDays,
          maxSessionMin,
          mode,
          weeks: numWeeks,
          targetDate,
          targetTime: targetTime || null,
          distanceKm,
          elevationM,
          level,
          constraints,
        },
        start_date: isoDateUtc(start),
        end_date: isoDateUtc(maxDate),
        content: { resume, semaines: allWeeks },
        status: "active",
      })
      .eq("id", planId);
  } catch (err) {
    console.error("generate-plan error:", err);
    if (planId) {
      await sb
        .from("training_plans")
        .update({ status: "error", content: { error: (err as Error).message } })
        .eq("id", planId);
    }
  }

  return new Response("", { status: 202 });
};
