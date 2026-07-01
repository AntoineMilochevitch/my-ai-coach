import { useState } from "react";

/**
 * Actions du header, responsives :
 *  - ≥ sm : boutons en ligne (Coach + Profil + Déconnexion)
 *  - < sm : un bouton « ⋮ » qui ouvre un menu déroulant
 * La pastille de statut Garmin est portée par le bouton Profil.
 */
export default function HeaderActions({
  dot,
  onChat,
  onPlan,
  onPlanning,
  onNutrition,
  onProfile,
  onSignOut,
}: {
  dot: string;
  onChat: () => void;
  onPlan: () => void;
  onPlanning: () => void;
  onNutrition: () => void;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  const btn =
    "flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";
  const item =
    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <>
      {/* Desktop */}
      <div className="hidden items-center gap-2 sm:flex">
        <button onClick={onChat} className={btn}>
          <ion-icon name="chatbubbles-outline" className="text-base"></ion-icon>
          Coach
        </button>
        <button onClick={onPlan} className={btn}>
          <ion-icon name="calendar-outline" className="text-base"></ion-icon>
          Plan
        </button>
        <button onClick={onPlanning} className={btn}>
          <ion-icon name="calendar-number-outline" className="text-base"></ion-icon>
          Planning
        </button>
        <button onClick={onNutrition} className={btn}>
          <ion-icon name="nutrition-outline" className="text-base"></ion-icon>
          Nutrition
        </button>
        <button onClick={onProfile} className={btn}>
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <ion-icon name="person-circle-outline" className="text-base"></ion-icon>
          Profil
        </button>
        <button onClick={onSignOut} className={btn} aria-label="Déconnexion">
          <ion-icon name="log-out-outline" className="text-base"></ion-icon>
        </button>
      </div>

      {/* Mobile */}
      <div className="relative sm:hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Menu"
          className={btn}
        >
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <ion-icon name="ellipsis-vertical-outline" className="text-base"></ion-icon>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
              <button
                onClick={() => {
                  setOpen(false);
                  onChat();
                }}
                className={item}
              >
                <ion-icon name="chatbubbles-outline" className="text-base"></ion-icon>
                Coach
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onPlan();
                }}
                className={item}
              >
                <ion-icon name="calendar-outline" className="text-base"></ion-icon>
                Plan
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onPlanning();
                }}
                className={item}
              >
                <ion-icon name="calendar-number-outline" className="text-base"></ion-icon>
                Planning
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onNutrition();
                }}
                className={item}
              >
                <ion-icon name="nutrition-outline" className="text-base"></ion-icon>
                Nutrition
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onProfile();
                }}
                className={item}
              >
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <ion-icon name="person-circle-outline" className="text-base"></ion-icon>
                Profil
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                className={item}
              >
                <ion-icon name="log-out-outline" className="text-base"></ion-icon>
                Déconnexion
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
