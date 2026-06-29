/** Helpers de formatage pour l'affichage (km, allure, durée, semaines). */

export function formatKm(m: number | null | undefined): string {
  return m ? (m / 1000).toFixed(2) + " km" : "—";
}

export function formatDuration(s: number | null | undefined): string {
  if (!s) return "—";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

/** Allure en min/km depuis des secondes/km, ex. 311 -> "5:11/km". */
export function formatPace(sPerKm: number | null | undefined): string {
  if (!sPerKm || sPerKm <= 0) return "—";
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/** Allure numérique en min/km (pour les axes de graphe). */
export function paceMinPerKm(sPerKm: number | null | undefined): number | null {
  return sPerKm && sPerKm > 0 ? +(sPerKm / 60).toFixed(2) : null;
}

/** Lundi de la semaine de `d` (clé de regroupement hebdo). */
export function weekStart(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function shortDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
