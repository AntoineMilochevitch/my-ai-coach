/**
 * Function PLANIFIÉE (cron) : scheduled-adapt — ré-adapte automatiquement le plan
 * actif de chaque utilisateur en début de semaine (lundi). Détaille la prochaine
 * fenêtre de séances selon l'état de forme réel.
 *
 * Pas de JWT : service_role + clé IA stockée par utilisateur (pas de repli
 * propriétaire ici, chacun utilise sa propre clé).
 */
import { serviceClient } from "./_shared/supabase.ts";
import { adaptPlanForUser } from "./_shared/plan-adapt.ts";

// Lundi 04:00 UTC (les plans commencent un lundi).
export const config = { schedule: "0 4 * * 1" };

export default async (): Promise<Response> => {
  const sb = serviceClient();
  const { data: plans } = await sb
    .from("training_plans")
    .select("user_id")
    .eq("status", "active");

  const userIds = [...new Set((plans ?? []).map((p) => p.user_id as string))];
  let adapted = 0;
  for (const userId of userIds) {
    try {
      const res = await adaptPlanForUser(sb, { id: userId });
      if (res.status === "adapted") adapted++;
    } catch (err) {
      console.error(`scheduled-adapt user ${userId}:`, (err as Error).message);
    }
  }

  return new Response(JSON.stringify({ users: userIds.length, adapted }), {
    headers: { "content-type": "application/json" },
  });
};
