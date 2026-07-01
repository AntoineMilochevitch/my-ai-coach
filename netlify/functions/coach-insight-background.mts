/**
 * Function (BACKGROUND) : coach-insight-background — message proactif du coach.
 * Court bilan (dernière séance commentée + alerte éventuelle + 1 conseil), écrit
 * dans coach_insights. Généré avec PARCIMONIE : le client ne le déclenche que
 * s'il est périmé (≥ ~20 h) et qu'il y a des données → ~1 appel IA / jour actif.
 *
 * POST {}  + Authorization: Bearer <jwt>  -> 202
 */
import { requireUser } from "./_shared/supabase.ts";
import { getLlm, isRateLimit } from "./_shared/llm/index.ts";
import { loadAiConfig } from "./_shared/ai-config.ts";
import { recordUsage } from "./_shared/usage.ts";
import { buildAthleteContext } from "./_shared/plan-context.ts";
import { loadText } from "./_shared/training-load.ts";

const SYSTEM = `Tu es le coach sportif personnel de cet athlète (course/vélo/fitness). Écris un
COURT message PROACTIF du jour (Markdown, ≤ 120 mots), comme si tu lui parlais maintenant :
- 1-2 phrases sur sa DERNIÈRE séance (réalisé + ressenti si dispo).
- 1 alerte SI un signal le justifie (FC repos en hausse, HRV bas, sommeil court, readiness bas,
  charge en forte hausse, séances manquées) ; sinon un encouragement sincère et mérité.
- 1 conseil ACTIONNABLE pour aujourd'hui ou la prochaine séance.
Français, tutoiement, chaleureux, concret et CHIFFRÉ (cite des vrais chiffres, en unités lisibles).
Pas de titre. Au plus 2-3 puces si vraiment utile. N'invente JAMAIS une donnée absente.`;

function fmtPace(sPerKm: number | null): string {
  if (!sPerKm || sPerKm <= 0) return "n/a";
  return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, "0")}/km`;
}

export default async (req: Request): Promise<Response> => {
  const ok = () => new Response("", { status: 202 });
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  try {
    ctx = await requireUser(req);
  } catch {
    return ok();
  }
  const { user, sb } = ctx;

  try {
    const cfg = await loadAiConfig(sb, user);
    const llm = getLlm(cfg.provider, cfg.apiKey, cfg.model);

    const { data: plan } = await sb
      .from("training_plans")
      .select("id, goal")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    const context = await buildAthleteContext(sb, user.id, plan?.id ?? null);

    // Dernière activité + son journal (ressenti/ravitaillement).
    const { data: lastAct } = await sb
      .from("activities")
      .select(
        "id, activity_type, start_time, distance_m, duration_s, avg_hr, max_hr, avg_pace_s_per_km, training_load, aerobic_te",
      )
      .eq("user_id", user.id)
      .order("start_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    let derniereSeance: any = null;
    if (lastAct) {
      const { data: log } = await sb
        .from("activity_logs")
        .select("ressenti, fueled, intake, carbs_g, fluids_ml")
        .eq("activity_id", lastAct.id)
        .maybeSingle();
      derniereSeance = {
        date: lastAct.start_time ? String(lastAct.start_time).slice(0, 10) : null,
        sport: lastAct.activity_type,
        distance_km: lastAct.distance_m ? +(lastAct.distance_m / 1000).toFixed(2) : null,
        duree_min: lastAct.duration_s ? Math.round(lastAct.duration_s / 60) : null,
        allure: lastAct.activity_type?.includes("running") ? fmtPace(lastAct.avg_pace_s_per_km) : null,
        fc_moy: lastAct.avg_hr ?? null,
        charge: lastAct.training_load ? Math.round(lastAct.training_load) : null,
        journal: log ?? null,
      };
    }

    // Séances à venir (7 jours).
    let prochaines: any[] = [];
    if (plan) {
      const today = new Date().toISOString().slice(0, 10);
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const { data: up } = await sb
        .from("plan_workouts")
        .select("scheduled_date, session_type, title, target")
        .eq("plan_id", plan.id)
        .gte("scheduled_date", today)
        .lte("scheduled_date", in7)
        .order("scheduled_date", { ascending: true })
        .limit(4);
      prochaines = up ?? [];
    }

    const athlete = {
      profil: context.profil,
      zones: context.zones,
      charge: context.charge,
      charge_resume: loadText(context.charge) || null,
      memoire: context.memoire.length ? context.memoire : null,
      objectif: plan?.goal ?? null,
      derniere_seance: derniereSeance,
      recuperation: context.recuperation,
      realise: context.realise_compteur,
      prochaines_seances: prochaines,
      notes: context.notes,
    };
    const userText =
      "Données de l'athlète (JSON) pour ton message du jour :\n\n```json\n" +
      JSON.stringify(athlete, null, 2) +
      "\n```";

    const { text, usage } = await llm.generate(SYSTEM, userText, {
      maxOutputTokens: 2048,
      thinkingBudget: 512,
      temperature: 0.6,
      timeoutMs: 40000,
      perAttemptMs: 12000,
    });
    await recordUsage(sb, user.id, "analyze", usage);
    await sb
      .from("coach_insights")
      .upsert(
        { user_id: user.id, content_md: text, created_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
  } catch (e) {
    // On ne persiste PAS d'erreur (le message précédent reste). Le client gère
    // l'absence de nouveau message (garde l'ancien / message discret).
    if (!isRateLimit(e)) console.error("coach-insight error:", (e as Error).message);
  }
  return ok();
};
