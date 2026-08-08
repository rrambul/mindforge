/**
 * Moved to `@mindforge/core` and re-exported here.
 *
 * The nightly worker needs the same rule and cannot import `apps/api`, so it had grown its own — and
 * the two diverged on the field FR-N4 says matters most: the worker replaced an unparseable row with
 * the default, un-muting a kind the user had switched off, while Settings still showed it as off.
 * Re-exported rather than moved outright so this module's importers are untouched.
 */
export {
  mergeNotificationPrefs,
  readStoredPref,
  type StoredNotificationPref,
} from "@mindforge/core";
