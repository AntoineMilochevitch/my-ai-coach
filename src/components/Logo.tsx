/**
 * Marque my-ai-coach : carré arrondi + tracé « pouls / allure » + étincelle (IA).
 * Le carré et l'étincelle s'adaptent au thème clair/sombre ; le tracé reste vert.
 */
export default function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="my-ai-coach">
      <rect width="32" height="32" rx="8" className="fill-neutral-900 dark:fill-neutral-100" />
      <path
        d="M4 18 H12 L14 10 L17 23 L19 16 L21 18 H28"
        fill="none"
        className="stroke-green-500"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.5" cy="8.5" r="1.7" className="fill-white dark:fill-neutral-900" />
    </svg>
  );
}
