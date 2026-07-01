/**
 * Thème clair / sombre / système, piloté par la classe `.dark` sur <html>
 * (voir @custom-variant dans index.css). Le choix est persisté en localStorage.
 * Un script inline dans index.html applique le thème AVANT le rendu (anti-flash).
 */
export type Theme = "light" | "dark" | "system";

const KEY = "theme";
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): Theme {
  const t = localStorage.getItem(KEY);
  return t === "light" || t === "dark" ? t : "system";
}

export function resolvedDark(t: Theme = getTheme()): boolean {
  return t === "dark" || (t === "system" && mq().matches);
}

export function applyTheme(t: Theme = getTheme()): void {
  const dark = resolvedDark(t);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(t: Theme): void {
  if (t === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, t);
  applyTheme(t);
}

/** Suit les changements système tant que le thème est en mode "system". */
export function initThemeListener(): () => void {
  const m = mq();
  const handler = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  m.addEventListener("change", handler);
  return () => m.removeEventListener("change", handler);
}
