import { useState } from "react";

/**
 * Actions du header, responsives :
 *  - ≥ sm : boutons en ligne (Garmin + Déconnexion)
 *  - < sm : un bouton « ⋮ » qui ouvre un menu déroulant
 */
export default function HeaderActions({
  dot,
  onGarmin,
  onSignOut,
}: {
  dot: string;
  onGarmin: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  const btn =
    "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";
  const item =
    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <>
      {/* Desktop */}
      <div className="hidden items-center gap-2 sm:flex">
        <button onClick={onGarmin} className={`flex items-center gap-2 ${btn}`}>
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          Garmin
        </button>
        <button onClick={onSignOut} className={btn}>
          Déconnexion
        </button>
      </div>

      {/* Mobile */}
      <div className="relative sm:hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
          className={`flex items-center gap-2 ${btn}`}
        >
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="text-base leading-none">⋮</span>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-2 w-44 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              <button
                onClick={() => {
                  onGarmin();
                  setOpen(false);
                }}
                className={item}
              >
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                Garmin
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                className={item}
              >
                Déconnexion
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
