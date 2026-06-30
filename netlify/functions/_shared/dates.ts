/**
 * Dates calendaires dans le fuseau de l'athlète, pour éviter les décalages d'un
 * jour entre UTC et l'heure locale (rapprochement des séances, dates de plan).
 * La locale "en-CA" formate en AAAA-MM-JJ.
 */
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Date calendaire (AAAA-MM-JJ) d'un instant donné, dans le fuseau `tz`. */
export function dateInTz(d: Date, tz: string): string {
  return fmt(tz).format(d);
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau `tz`. */
export function todayInTz(tz: string): string {
  return fmt(tz).format(new Date());
}

/**
 * Lundi de la semaine en cours (ou aujourd'hui s'il s'agit d'un lundi), comme
 * date calendaire ancrée à minuit UTC — toute l'arithmétique de date du plan se
 * fait ensuite en UTC à partir de cette ancre (pas de mélange local/UTC).
 */
export function upcomingMondayUtc(tz: string): Date {
  const anchor = new Date(`${todayInTz(tz)}T00:00:00Z`);
  const add = (1 - anchor.getUTCDay() + 7) % 7; // 0 si lundi
  anchor.setUTCDate(anchor.getUTCDate() + add);
  return anchor;
}

/** Date calendaire (AAAA-MM-JJ) d'une ancre UTC. */
export function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}
