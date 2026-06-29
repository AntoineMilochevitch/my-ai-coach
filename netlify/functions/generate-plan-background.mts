/**
 * Function (BACKGROUND) : generate-plan-background — génère un plan d'entraînement
 * personnalisé via Gemini. Les fonctions `-background` renvoient 202 immédiatement
 * et tournent jusqu'à 15 min : on contourne ainsi le timeout 10 s des fonctions
 * synchrones (génération IA longue).
 *
 * Cycle d'état dans training_plans : "generating" -> "active" | "error".
 * Le client interroge (poll) la table jusqu'à la fin.
 *
 * POST { mode, objective, targetTime?, distanceKm?, elevationM?, targetDate?, weeks?,
 *        sessionsPerWeek?, maxSessionMin?, level?, constraints? } + Authorization Bearer
 */
import { requireUser } from "./_shared/supabase.ts";
import { geminiGenerateJSON } from "./_shared/gemini.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";

const SYSTEM = `# RÔLE
Tu es un coach d'endurance expert, spécialisé course à pied.
Tu construis un plan d'entraînement STRUCTURÉ, PROGRESSIF et RÉALISTE, calibré sur
les données réelles de l'athlète. Principes :
- Progressivité (hausse de volume hebdo ~10% max), alternance charge/récup.
- Répartition ~80% facile / 20% intensité ; au moins 1 jour de repos.
- Calibre les allures cibles sur le chrono visé, les allures et la VO₂max de l'athlète.
- Respecte le nombre de séances/semaine et la durée max par séance demandés.
- Si une date d'objectif est donnée : inclure un affûtage les derniers jours.
- jour = entier 1..7 (1=lundi … 7=dimanche). type ∈ {easy, long, tempo, interval,
  recovery, rest, cross, strength}. Renforcement/cross-training en complément, optionnels.
Réponds UNIQUEMENT via le schéma JSON imposé (aucun texte hors JSON).`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    resume: { type: "STRING" },
    semaines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          num: { type: "INTEGER" },
          focus: { type: "STRING" },
          seances: {
            type: "ARRAY",
            items: {
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
              },
              required: ["jour", "sport", "type", "titre", "description"],
            },
          },
        },
        required: ["num", "focus", "seances"],
      },
    },
  },
  required: ["resume", "semaines"],
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function upcomingMonday(): Date {
  const d = new Date();
  const add = (1 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  d.setHours(0, 0, 0, 0);
  return d;
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
    const cfg = await loadAiConfig(sb, user.id);

    const mode = body.mode === "date" ? "date" : "weeks";
    const objective = String(body.objective || "Forme générale");
    const sessionsPerWeek = Math.min(Math.max(Number(body.sessionsPerWeek) || 4, 2), 7);
    const maxSessionMin = Number(body.maxSessionMin) || null;
    const level = String(body.level || "intermédiaire");
    const constraints = String(body.constraints || "");
    const preferredDays: number[] = Array.isArray(body.preferredDays)
      ? body.preferredDays.map((d: any) => Number(d)).filter((d: number) => d >= 1 && d <= 7)
      : [];
    const perWeek = preferredDays.length || sessionsPerWeek;
    const targetTime = String(body.targetTime || "").trim();
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

    const start = upcomingMonday();
    let numWeeks: number;
    let targetDate: string | null = null;
    if (mode === "date") {
      targetDate = String(body.targetDate || "");
      const t = new Date(targetDate);
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
    const userText =
      `Génère un plan de ${numWeeks} semaine(s), ${perWeek} séance(s)/semaine, ` +
      `objectif "${goalLabel}"${targetDate ? `, date cible ${targetDate}` : ""}. ` +
      daysClause +
      adaptClause +
      `Calibre les allures/efforts sur le chrono visé et les données. ` +
      `Données de l'athlète (JSON) :\n\n\`\`\`json\n${JSON.stringify(athlete, null, 2)}\n\`\`\``;

    const plan = await geminiGenerateJSON<any>(cfg.apiKey, cfg.model, SYSTEM, userText, SCHEMA, {
      maxOutputTokens: 32768,
    });

    const rows: any[] = [];
    let maxDate = start;
    for (const week of plan.semaines ?? []) {
      const wnum = Number(week.num) || 1;
      for (const s of week.seances ?? []) {
        const jour = Math.min(Math.max(Number(s.jour) || 1, 1), 7);
        const date = new Date(start);
        date.setDate(start.getDate() + (wnum - 1) * 7 + (jour - 1));
        if (date > maxDate) maxDate = date;
        if (s.type === "rest") continue;
        rows.push({
          plan_id: planId,
          user_id: user.id,
          scheduled_date: isoDate(date),
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
        start_date: isoDate(start),
        end_date: isoDate(maxDate),
        content: plan,
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
