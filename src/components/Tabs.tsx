export interface TabDef {
  key: string;
  label: string;
  icon?: string;
}

/**
 * Barre d'onglets réutilisable : sticky sous le header, défilable horizontalement
 * sur petit écran, indicateur souligné pour l'onglet actif.
 */
export default function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="no-scrollbar sticky top-14 z-20 -mx-4 flex gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-50/90 px-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90 sm:-mx-6 sm:px-6">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            aria-current={on ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
              on
                ? "border-green-600 font-medium text-neutral-900 dark:text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            {t.icon && <ion-icon name={t.icon} className="text-base"></ion-icon>}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
