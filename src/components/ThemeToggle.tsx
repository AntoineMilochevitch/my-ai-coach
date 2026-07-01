import { useEffect, useState } from "react";
import { getTheme, setTheme, initThemeListener, type Theme } from "../lib/theme";

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const ICON: Record<Theme, string> = {
  system: "contrast-outline",
  light: "sunny-outline",
  dark: "moon-outline",
};
const LABEL: Record<Theme, string> = { system: "Système", light: "Clair", dark: "Sombre" };

/** Bouton de thème : cycle Système → Clair → Sombre. */
export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  useEffect(() => initThemeListener(), []);

  const cycle = () => {
    const next = NEXT[theme];
    setTheme(next);
    setThemeState(next);
  };

  return (
    <button
      onClick={cycle}
      title={`Thème : ${LABEL[theme]} (cliquer pour changer)`}
      aria-label={`Thème : ${LABEL[theme]}`}
      className="flex items-center rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <ion-icon name={ICON[theme]} className="text-base"></ion-icon>
    </button>
  );
}
