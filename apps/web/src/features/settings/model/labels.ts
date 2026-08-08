/**
 * The parts of this screen that are formatting rather than copy.
 *
 * A weekday name, an hour, and a date are not translations — they are `Intl`'s job, and putting
 * "Sunday" in the bundle would mean maintaining seven strings per locale that the platform already
 * knows, in the platform's own capitalisation rules (§5.2: never hand-format a date).
 *
 * Everything below anchors to a *fixed* instant and formats it in UTC, so the labels describe the
 * value being picked rather than the machine's clock. 2024-01-07 is a Sunday, which is what makes
 * index 0 = Sunday line up with `Profile.weekStartsOn` and `notification_prefs.config.weekday`.
 */

const REFERENCE_SUNDAY = Date.UTC(2024, 0, 7);
const DAY_MS = 86_400_000;

/** Index 0 = Sunday, matching the stored value. */
export function weekdayLabels(locale: string): readonly string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_unused, day) =>
    format.format(new Date(REFERENCE_SUNDAY + day * DAY_MS)),
  );
}

/**
 * A local hour, 0–23, written the way the locale writes hours — "6 PM" in en, "18" in pt-BR.
 *
 * `hour12` is deliberately not passed: which convention a language uses is exactly the thing `Intl`
 * exists to know, and overriding it here would ship an American clock to a Brazilian interface.
 */
export function hourLabel(locale: string, hour: number): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).format(
    new Date(REFERENCE_SUNDAY + hour * 3_600_000),
  );
}

/**
 * What time it is right now in a candidate zone, or null if the engine does not know the zone.
 *
 * The feedback that makes the picker honest: `America/Sao_Paulo` is a string, "14:32 GMT-3" is the
 * thing you are actually choosing, and it is how you notice you picked the wrong São Paulo.
 */
export function zoneTimeLabel(locale: string, timeZone: string, at: Date): string | null {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(at);
  } catch {
    return null;
  }
}

/**
 * A release date (§14.1). Null in, null out — `date` is absent for a release written before
 * release-please dated its heading, and "unknown date" is not 1 January 1970.
 */
export function releaseDateLabel(locale: string, date: string | null): string | null {
  if (date === null) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    // The date in the heading is a calendar date, not an instant. Formatting it in the reader's zone
    // would put a release west of Greenwich on the previous day.
    timeZone: "UTC",
  }).format(parsed);
}
