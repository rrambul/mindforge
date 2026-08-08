import { StallPayloadSchema } from "@mindforge/core";
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

export function nudgeMessage(nudge: Nudge): NudgeMessage {
  if (nudge.kind === "stall") {
    // Parsed through the shared schema rather than read field by field. Reading by hand is how this
    // came to look for `missionTopic` while the worker wrote `topic`: every nudge fell through to
    // the anonymous fallback and nothing failed. `safeParse` rather than `parse` because a row
    // written by an older release must degrade to the unnamed message, not crash the bar.
    const parsed = StallPayloadSchema.safeParse(nudge.payload);
    if (parsed.success) {
      return { key: "stall", args: parsed.data };
    }

    // A payload that has the name but not the count is still worth a sentence — the mission is the
    // part that makes the nudge actionable.
    const missionTopic = text(nudge.payload, "missionTopic");
    return missionTopic === null
      ? { key: "stallUnnamed", args: {} }
      : { key: "stallUndated", args: { missionTopic } };
  }

  // The weekly review nudge is about the week, not about a thing in it, so it needs no arguments —
  // and a payload that carries some is free to; extra ICU arguments are ignored.
  return { key: "weeklyReview", args: {} };
}
