/**
 * Function (BACKGROUND) : generate-plan-background — CRÉE un plan adaptatif.
 * On génère le MACRO (périodisation sur tout l'horizon) puis on ne DÉTAILLE que
 * les premières semaines (fenêtre glissante DETAIL_WEEKS). Les semaines suivantes
 * sont détaillées plus tard par l'adaptation (manuelle ou auto hebdomadaire), en
 * fonction de l'état de forme réel.
 *
 * Cycle d'état dans training_plans : "generating" -> "active" | "error".
 */
import { requireUser } from "./_shared/supabase.ts";
import { getLlm } from "./_shared/llm/index.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { checkQuota, recordUsage } from "./_shared/usage.ts";
import { upcomingMondayUtc, isoDateUtc } from "./_shared/dates.ts";
import { buildAthleteContext } from "./_shared/plan-context.ts";
import { generateMacro, generateDetail, weeksToRows, DETAIL_WEEKS } from "./_shared/plan-core.ts";

export default async (req: Request): Promise<Response> => {
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  try {
    ctx = await requireUser(req);
  } catch {
    return new Response("", { status: 202 });
  }
  const { user, sb } = ctx;
  const body = await req.json().catch(() => ({}));

  // Plan actif précédent : on le garde le temps de bâtir le contexte (réalisé),
  // puis on l'archive.
  const { data: prior } = await sb
    .from("training_plans")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const priorPlanId = prior?.id ?? null;

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

    const context = await buildAthleteContext(sb, user.id, priorPlanId);
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
      duree_max_min: maxSessionMin,
      contraintes: constraints,
      contexte: context,
    };
    const athleteText =
      `Objectif & contraintes + état de forme de l'athlète (JSON) :\n\n\`\`\`json\n${JSON.stringify(
        athlete,
        null,
        2,
      )}\n\`\`\``;

    const usage = { in: 0, out: 0 };

    // 1) MACRO sur tout l'horizon.
    const macro = await generateMacro(llm, athleteText, numWeeks, usage);
    if (!macro.semaines.length) throw new Error("Macro vide : réessaie.");

    // 2) DÉTAIL des premières semaines seulement (fenêtre glissante).
    const detailTo = Math.min(numWeeks, DETAIL_WEEKS);
    const weeks = await generateDetail(llm, athleteText, macro.semaines, 1, detailTo, usage);
    await recordUsage(sb, user.id, "plan", usage);

    const rows = weeksToRows(weeks, planId!, user.id, start);
    if (rows.length) {
      const { error: wErr } = await sb.from("plan_workouts").insert(rows);
      if (wErr) throw new Error(wErr.message);
    }

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + numWeeks * 7 - 1);

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
        end_date: isoDateUtc(end),
        macro: { resume: macro.resume, semaines: macro.semaines },
        content: { resume: macro.resume },
        detail_weeks: DETAIL_WEEKS,
        last_adapted_at: new Date().toISOString(),
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
