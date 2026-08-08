import {
  defaultNotificationPrefs,
  NotificationPrefSchema,
  type NotificationPref,
} from "@mindforge/core";

/**
 * One row of `notification_prefs` as Postgres hands it over.
 *
 * `config` is `unknown` because the column is jsonb: whatever shape the build that wrote it
 * believed in is what comes back, and this build has to decide what to make of it.
 */
export interface StoredNotificationPref {
  readonly kind: string;
  readonly enabled: boolean;
  readonly config: unknown;
}

/**
 * Validate on the way **out**, not only on the way in.
 *
 * A row written by an older version of the app is the case that would otherwise reach the SPA
 * malformed — the request schema only ever saw the requests this build accepted, and jsonb keeps
 * whatever it was given. `NotificationPrefSchema` is strict, so a renamed or dropped config key
 * fails here rather than becoming a settings screen that renders undefined.
 *
 * Null means the row cannot be understood at all and the caller should fall back to the default.
 */
export function readStoredPref(row: StoredNotificationPref): NotificationPref | null {
  const whole = NotificationPrefSchema.safeParse(row);
  if (whole.success) return whole.data;

  // A config we can no longer parse must not silently un-mute something the user switched off.
  // FR-N4's entire argument is that "a nagging app gets muted, then deleted", so the switch is the
  // setting that matters most — and `enabled` is a boolean column with no shape to drift. Keep it,
  // and let only the unreadable config fall back to its defaults.
  const switchOnly = NotificationPrefSchema.safeParse({ kind: row.kind, enabled: row.enabled });
  return switchOnly.success ? switchOnly.data : null;
}

/**
 * The stored rows over the defaults, so a profile with no rows behaves as every kind enabled.
 *
 * Merged at read time and **never seeded**: a seeded row would freeze today's defaults into an
 * account forever, so changing what "quiet by default" means would reach new users and nobody else.
 * The absence of a row is the setting.
 *
 * Order follows `NOTIFICATION_KINDS` — via `defaultNotificationPrefs`, which is built from it —
 * rather than whatever order Postgres returned the rows in. Sorting `kind` in SQL would be
 * alphabetical, which is the trap this codebase has fallen into twice.
 */
export function mergeNotificationPrefs(
  stored: readonly NotificationPref[],
): readonly NotificationPref[] {
  const byKind = new Map(stored.map((pref) => [pref.kind, pref]));
  return defaultNotificationPrefs().map((fallback) => byKind.get(fallback.kind) ?? fallback);
}
