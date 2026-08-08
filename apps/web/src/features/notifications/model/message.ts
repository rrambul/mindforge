import type { Nudge } from "../api/use-notifications.js";

/**
 * Which message a nudge renders as, and with which arguments.
 *
 * The row carries a `kind` and a bag of ICU arguments; the sentence lives in the locale bundle. That
 * split is what lets the same nudge read in either language (§5.2) — but it also means the row and
 * the message can disagree, because nothing type-checks a jsonb column against a translation file.
 *
 * **A missing argument must not be able to blank the list.** ICU throws when a message references an
 * argument it was not given, and the nudges are raised by the nightly job in M3 — code that does not
 * exist yet, against payloads nothing here can verify. So the shape is checked before the message is
 * chosen, and a row whose payload does not carry what its sentence needs falls back to the sentence
 * that needs nothing. Degraded copy beats a screen that throws, and inventing a mission name to fill
 * the gap would be worse than either.
 */
export interface NudgeMessage {
  /** A key under `notifications.kind` in the `settings` bundle. */
  readonly key: string;
  readonly args: Readonly<Record<string, string | number>>;
}

function text(payload: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = payload[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function count(payload: Readonly<Record<string, unknown>>, field: string): number | null {
  const value = payload[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function nudgeMessage(nudge: Nudge): NudgeMessage {
  if (nudge.kind === "stall") {
    const missionTopic = text(nudge.payload, "missionTopic");
    // `untouchedDays` is what `detectStalls` computes; `days` is the shorter name a payload might
    // reasonably use. Accepting both costs one line and saves a nudge that would otherwise render
    // as the anonymous fallback.
    const days = count(nudge.payload, "days") ?? count(nudge.payload, "untouchedDays");

    if (missionTopic !== null && days !== null) {
      return { key: "stall", args: { missionTopic, days } };
    }
    if (missionTopic !== null) {
      return { key: "stallUndated", args: { missionTopic } };
    }
    return { key: "stallUnnamed", args: {} };
  }

  // The weekly review nudge is about the week, not about a thing in it, so it needs no arguments —
  // and a payload that carries some is free to; extra ICU arguments are ignored.
  return { key: "weeklyReview", args: {} };
}
