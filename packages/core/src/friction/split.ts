/**
 * Turning friction events into ember and slag **minutes**.
 *
 * This is the product's headline number, and until M2 it was quietly a different number than its
 * name claimed. `frictionSplit` weighted every event as exactly one minute, so `emberShare` was a
 * share of the *count* of events, dressed in a field called minutes. CLAUDE.md recorded it as an
 * interim proxy expiring here, and §3.5 stores `ember_minutes` / `slag_minutes` while §3.9 describes
 * hue as a fraction of "the day's friction" — the two disagreed and neither said what the rule was.
 *
 * **The rule, stated once.** A friction event is a moment, not a duration: nothing in the schema
 * records how long an interruption cost, and asking would break the ≤5s capture budget that makes
 * the data exist at all. So minutes are attributed rather than measured — a session's own length is
 * divided among its friction events in proportion to their **intensity**, and each share is
 * classified by the event that earned it.
 *
 * Three consequences worth being explicit about, because each is a choice and not a fact:
 *
 * 1. **A session with no friction contributes to neither.** Its minutes are focus minutes and
 *    nothing else. Calling unexamined time ember would be the flattering answer and the wrong one:
 *    an hour you never noticed anything about is not an hour of demonstrated productive struggle.
 *    So `emberMinutes + slagMinutes` covers only the sessions that hit friction, and does not sum to
 *    `focusMinutes`. The `daily_activity` columns are documented to that effect.
 *
 * 2. **Intensity finally does something.** It has been collected on every event since M1 and read by
 *    nothing. Weighting by it says that an hour containing one shrugged-off interruption and one
 *    bruising stretch of productive struggle was mostly the second thing, which is what it felt like.
 *
 * 3. **The classification can change after the fact.** §9.3 makes `too_hard` productive only if the
 *    session produced learning, and the debrief that decides it may be written the next morning. Any
 *    stored rollup of these numbers has to be rebuildable rather than append-only — which is why
 *    `daily_activity` carries `rebuilt_at` and the nightly job re-rolls recent days rather than only
 *    yesterday.
 */

import { classifyFriction, type FrictionType, type SessionOutcome } from "./classify.js";

/** One tap. Intensity is 1–5 and defaults to 3 at capture time (§5.3). */
export interface FrictionMoment {
  readonly type: FrictionType;
  readonly intensity: number;
}

/** A session and everything that interrupted it. */
export interface SessionFriction {
  /** The session's own length. Rounded to whole minutes here, since that is the unit stored. */
  readonly minutes: number;
  /** Whether the session produced learning — what §9.3's conditional turns on. */
  readonly outcome: SessionOutcome;
  readonly events: readonly FrictionMoment[];
}

export interface FrictionSplit {
  readonly emberMinutes: number;
  readonly slagMinutes: number;
  /**
   * Productive share of the attributed minutes, 0–1, or **null when nothing was attributed**.
   *
   * Null rather than zero, and this is the difference the whole product turns on: zero says every
   * minute of friction you hit was wasted, which is a measurement. Null says you logged none, which
   * is the absence of one. A grid cell that shaded a frictionless day as pure slag would be lying
   * about the best kind of day there is.
   */
  readonly emberShare: number | null;
}

const EMPTY: FrictionSplit = { emberMinutes: 0, slagMinutes: 0, emberShare: null };

/**
 * Attribute one session's minutes across its friction events.
 *
 * Whole minutes out, and they add up exactly: the shares are floored and the remainder handed to the
 * largest fractional parts, so nothing is lost to rounding. A rollup that dropped a minute per
 * session would drift by hours over a month, and the drift would land entirely in whichever class
 * happened to round down.
 */
export function splitSession(session: SessionFriction): FrictionSplit {
  const minutes = Math.round(session.minutes);
  if (minutes < 0) {
    throw new RangeError(`session minutes must be >= 0, received ${session.minutes}`);
  }

  if (session.events.length === 0 || minutes === 0) return EMPTY;

  let totalWeight = 0;
  for (const event of session.events) {
    if (!Number.isInteger(event.intensity) || event.intensity < 1 || event.intensity > 5) {
      // Thrown rather than clamped. An out-of-range intensity can only come from a row nobody
      // validated, and quietly treating a 9 as a 5 produces a confidently wrong headline number —
      // which is the one failure mode this product calls a bug regardless of what else improves.
      throw new RangeError(`intensity must be an integer 1–5, received ${event.intensity}`);
    }
    totalWeight += event.intensity;
  }

  const shares = session.events.map((event) => {
    const exact = (minutes * event.intensity) / totalWeight;
    const whole = Math.floor(exact);
    return { event, whole, fraction: exact - whole };
  });

  let assigned = shares.reduce((sum, s) => sum + s.whole, 0);
  // Largest remainder first; ties go to the earlier event, which keeps the result stable for a
  // given input rather than depending on sort implementation.
  const byRemainder = shares
    .map((share, index) => ({ share, index }))
    .sort((a, b) => b.share.fraction - a.share.fraction || a.index - b.index);

  for (const { share } of byRemainder) {
    if (assigned >= minutes) break;
    share.whole += 1;
    assigned += 1;
  }

  let emberMinutes = 0;
  let slagMinutes = 0;
  for (const { event, whole } of shares) {
    if (classifyFriction(event.type, session.outcome) === "productive") emberMinutes += whole;
    else slagMinutes += whole;
  }

  return { emberMinutes, slagMinutes, emberShare: shareOf(emberMinutes, slagMinutes) };
}

/** The same attribution summed over a day, a week, or a mission. */
export function frictionSplit(sessions: Iterable<SessionFriction>): FrictionSplit {
  let emberMinutes = 0;
  let slagMinutes = 0;

  for (const session of sessions) {
    const split = splitSession(session);
    emberMinutes += split.emberMinutes;
    slagMinutes += split.slagMinutes;
  }

  return { emberMinutes, slagMinutes, emberShare: shareOf(emberMinutes, slagMinutes) };
}

/**
 * Productive share of attributed minutes, or null when none were.
 *
 * Exported because the rollup stores the two minute columns and the grid recomputes the share from
 * them — reading a stored share would be a third place for the same number to disagree.
 */
export function emberShare(emberMinutes: number, slagMinutes: number): number | null {
  return shareOf(emberMinutes, slagMinutes);
}

function shareOf(ember: number, slag: number): number | null {
  const total = ember + slag;
  return total === 0 ? null : ember / total;
}
