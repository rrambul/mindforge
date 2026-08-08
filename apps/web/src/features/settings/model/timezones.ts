import { resolveTimeZone } from "@mindforge/core";

/**
 * The timezone list, and the check that decides whether a typed one is real.
 *
 * **Both come from `Intl`, never from a list in this file.** The IANA database gains and loses zones
 * every year — `Europe/Kyiv` was added in 2022, `America/Nuuk` renamed in 2020 — so a hardcoded list
 * is wrong within a year and wrong in a way nobody notices until somebody's zone is missing. The API
 * validates the same way (`UpdateProfileSchema`), so the client cannot accept a zone the server will
 * reject, and neither of them has a list to maintain.
 */

/**
 * `resolveTimeZone` falls back to UTC rather than throwing, which is right for rendering a stored row
 * and wrong for validating an input — so identity is the test. Shared with the API through
 * `packages/core`, which is what keeps the two from disagreeing about what a zone is.
 */
export function isKnownTimeZone(value: string): boolean {
  return resolveTimeZone(value) === value;
}

/** What the browser thinks it is in. The starting point, not the answer — the profile owns that. */
export function browserTimeZone(): string {
  return resolveTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Every zone the engine knows, plus whatever the profile is already set to.
 *
 * That last part matters more than it looks: an account carrying a zone this engine has since
 * renamed would otherwise find its own current setting missing from the list of things it may be set
 * to, which reads as data loss. `supportedValuesOf` is ES2022 and absent from older engines, so its
 * absence degrades to "no suggestions" — the field still validates and still submits.
 */
export function supportedTimeZones(current: string | null = null): readonly string[] {
  const zones = new Set<string>();

  if (typeof Intl.supportedValuesOf === "function") {
    for (const zone of Intl.supportedValuesOf("timeZone")) zones.add(zone);
  }
  if (current !== null && current !== "") zones.add(current);

  return [...zones].sort((a, b) => a.localeCompare(b));
}
