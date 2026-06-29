/** Petit loader qui tourne (Tailwind animate-spin). */
export default function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px] ${className}`}
    />
  );
}
