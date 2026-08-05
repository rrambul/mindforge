import type { CreateFocusSessionInput, IntentionOutcome } from "@mindforge/core";
import { now } from "../../../shared/lib/clock.js";

/**
 * What the backfill form holds, before it becomes a request.
 *
 * Deliberately *not* the API's shape. The wire takes two absolute instants; a person remembering
 * a block they forgot to time knows "yesterday, from about nine, for about forty minutes". Asking
 * for two full datetimes would be six edits, and FR-F2 is explicit that if backfilling is painful
 * the data dies within two weeks.
 */
export interface PastSessionForm {
  /** `YYYY-MM-DD`, as an <input type="date"> gives it. */
  readonly date: string;
  /** `HH:MM`, as an <input type="time"> gives it. */
  readonly startTime: string;
  readonly minutes: number;
  readonly intention: string;
  readonly hitIntention: IntentionOutcome | null;
  readonly focusQuality: number | null;
  readonly energy: number | null;
}

/** Not zero: a default that fails validation makes the first thing you see an error. */
const DEFAULT_MINUTES = 30;

/**
 * A block that ended about now.
 *
 * Anchored to the *end* rather than rounding the start to the hour, and that is a correctness point
 * rather than a taste one: rounding the start down and adding a fixed length puts the session in the
 * future for most of every hour — at 14:05, a 14:00 start plus 30 minutes ends at 14:30, which has
 * not happened. The pre-filled form would then fail its own validation, which is the worst possible
 * first impression for the one flow FR-F2 says must not be painful.
 *
 * Rounded down to five minutes, so the common case reads as a round number and the end still cannot
 * land after now.
 */
export function defaultPastSession(reference: Date = now()): PastSessionForm {
  const start = new Date(reference.getTime() - DEFAULT_MINUTES * 60_000);
  start.setMinutes(Math.floor(start.getMinutes() / 5) * 5, 0, 0);

  return {
    date: localDateString(start),
    startTime: localTimeString(start),
    minutes: DEFAULT_MINUTES,
    intention: "",
    hitIntention: null,
    focusQuality: null,
    energy: null,
  };
}

export interface PastSessionProblem {
  readonly field: "date" | "startTime" | "minutes";
  readonly code: "required" | "invalid" | "future" | "too_long";
}

/**
 * Converts the form to the request, or reports why it cannot.
 *
 * Two things are worth stating about the timezone. The date and time are read in the **device's**
 * zone, because that is the zone the person typing them was standing in — `new Date("2026-08-05T09:00")`
 * is 9am where you are, which is what "I worked at nine" means. The result is an absolute instant,
 * so the server and every later rollup can bucket it by the profile's zone (§5.2) without this
 * needing to know it.
 *
 * A future session is refused rather than clamped: unlike a stop arriving before its start — where
 * the block genuinely happened and refusing would leave a timer running — a block in the future did
 * not happen, and recording it would put time into the week's totals that nobody spent.
 */
export function pastSessionToInput(
  form: PastSessionForm,
  reference: Date = now(),
): { input: CreateFocusSessionInput } | { problem: PastSessionProblem } {
  if (form.date === "") return { problem: { field: "date", code: "required" } };
  if (form.startTime === "") return { problem: { field: "startTime", code: "required" } };

  const startedAt = new Date(`${form.date}T${form.startTime}`);
  if (Number.isNaN(startedAt.getTime())) {
    return { problem: { field: "date", code: "invalid" } };
  }

  if (!Number.isFinite(form.minutes) || form.minutes < 1) {
    return { problem: { field: "minutes", code: "required" } };
  }
  // The API caps a planned length at 600; a recorded one longer than a day is a typo rather than a
  // marathon, and letting it through would distort every average it lands in.
  if (form.minutes > 24 * 60) {
    return { problem: { field: "minutes", code: "too_long" } };
  }

  const endedAt = new Date(startedAt.getTime() + form.minutes * 60_000);
  if (endedAt > reference) {
    return { problem: { field: "startTime", code: "future" } };
  }

  const intention = form.intention.trim();

  return {
    input: {
      startedAt,
      endedAt,
      ...(intention === "" ? {} : { intention }),
      ...(form.hitIntention === null ? {} : { hitIntention: form.hitIntention }),
      ...(form.focusQuality === null ? {} : { focusQuality: form.focusQuality }),
      ...(form.energy === null ? {} : { energy: form.energy }),
    },
  };
}

function localDateString(date: Date): string {
  // Not toISOString().slice(0,10): that is UTC, so anyone west of Greenwich would see yesterday's
  // date pre-filled for a session they are logging today.
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeString(date: Date): string {
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}
