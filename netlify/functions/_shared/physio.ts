/**
 * Données physiques de l'athlète (sexe, taille, poids, âge, IMC), lues depuis
 * profiles. Fournies au contexte IA pour des recommandations plus précises.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Physio {
  sexe: string | null;
  taille_cm: number | null;
  poids_kg: number | null;
  age: number | null;
  imc: number | null;
}

export async function loadPhysio(sb: SupabaseClient, userId: string): Promise<Physio | null> {
  const { data } = await sb
    .from("profiles")
    .select("sex, height_cm, weight_kg, birth_date")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;

  const sexe = data.sex ? (data.sex === "M" ? "homme" : data.sex === "F" ? "femme" : "autre") : null;
  const taille = data.height_cm ? Number(data.height_cm) : null;
  const poids = data.weight_kg ? Number(data.weight_kg) : null;

  let age: number | null = null;
  if (data.birth_date) {
    const b = new Date(`${data.birth_date}T00:00:00Z`);
    if (!Number.isNaN(b.getTime())) {
      const now = new Date();
      age = now.getUTCFullYear() - b.getUTCFullYear();
      const before =
        now.getUTCMonth() < b.getUTCMonth() ||
        (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
      if (before) age--;
    }
  }

  const imc = taille && poids ? Math.round((poids / (taille / 100) ** 2) * 10) / 10 : null;
  if (!sexe && taille == null && poids == null && age == null) return null;
  return { sexe, taille_cm: taille, poids_kg: poids, age, imc };
}

/** Ligne lisible du profil, ou "" si rien de renseigné. */
export function physioLine(p: Physio | null): string {
  if (!p) return "";
  return [
    p.sexe,
    p.taille_cm ? `${p.taille_cm} cm` : "",
    p.poids_kg ? `${p.poids_kg} kg` : "",
    p.age != null ? `${p.age} ans` : "",
    p.imc ? `IMC ${p.imc}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}
