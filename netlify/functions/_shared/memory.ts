/**
 * Mémoire du coach : faits DURABLES sur l'athlète (objectifs, blessures,
 * préférences, contraintes) réutilisés d'une conversation à l'autre.
 * Un fait = une ligne dans coach_memory. Injecté dans le contexte IA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MemoryItem {
  id?: string;
  category: string;
  content: string;
}

const ORDER = ["objectif", "blessure", "preference", "contrainte", "autre"];
const LABELS: Record<string, string> = {
  objectif: "Objectifs",
  blessure: "Blessures / santé",
  preference: "Préférences",
  contrainte: "Contraintes",
  autre: "Divers",
};

export async function loadMemory(sb: SupabaseClient, userId: string): Promise<MemoryItem[]> {
  const { data } = await sb
    .from("coach_memory")
    .select("id, category, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(80);
  return (data ?? []).map((r) => ({ id: r.id, category: r.category, content: r.content }));
}

/** Bloc markdown groupé par catégorie. "" si mémoire vide. */
export function memoryText(items: MemoryItem[]): string {
  if (!items.length) return "";
  const byCat = new Map<string, string[]>();
  for (const it of items) {
    const k = ORDER.includes(it.category) ? it.category : "autre";
    const arr = byCat.get(k) ?? [];
    arr.push(it.content);
    byCat.set(k, arr);
  }
  const parts: string[] = [];
  for (const k of ORDER) {
    const arr = byCat.get(k);
    if (arr?.length) parts.push(`**${LABELS[k]}** : ${arr.join(" ; ")}`);
  }
  return parts.join("\n");
}
