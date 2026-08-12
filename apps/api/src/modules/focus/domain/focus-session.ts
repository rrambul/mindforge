import {
  elapsedMinutes,
  localDay,
  resolveTimeZone,
  type EntryMode,
  type IntentionOutcome,
  type StartEntryMode,
} from "@mindforge/core";
import { FocusSessionNotRunning, FocusSessionNotStopped, SessionInFuture } from "./errors.js";

export interface FocusSessionAttachments {
  readonly missionId: string | null;
  /**
   * The lesson the block was spent on (FR-F3).
   *
   * Implies the mission, and the database says so too
   * (`focus_sessions_lesson_implies_mission`): a session with a lesson and no
   * mission vanishes from every per-mission total while still counting in the
   * global one, and the two figures disagree with nobody able to say why. The
   * pair is resolved in the use case, because a lesson's mission is a fact about
   * another row and nothing in here can read one.
   */
  readonly lessonId: string | null;
}

export interface FocusSessionDebrief {
  readonly hitIntention: IntentionOutcome | null;
  readonly focusQuality: number | null;
  readonly energy: number | null;
  readonly note: string | null;
}

export interface FocusSessionSnapshot extends FocusSessionAttachments, FocusSessionDebrief {
  readonly id: string;
  readonly userId: string;
  readonly intention: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly plannedMinutes: number | null;
  readonly entryMode: EntryMode;
  readonly createdAt: Date;
}

/**
 * A block of attention.
 *
 * The rules here are the ones that make the *data* trustworthy rather than the ones that
 * make the UI convenient — a session cannot end before it started, cannot be stopped twice,
 * and cannot be debriefed while it is still running. Every one of them is enforced here
 * rather than only in the Zod schema, because the seed scripts, the eventual `mindforge`
 * CLI, and manual backfill all construct sessions too.
 *
 * "Only one running at a time" is deliberately *not* here: that is a rule about the set of
 * a user's sessions, so it lives in the use case, next to the repository that can see them.
 */
export class FocusSession {
  private constructor(
    readonly id: string,
    readonly userId: string,
    private intentionValue: string | null,
    readonly startedAt: Date,
    private endedAtValue: Date | null,
    private plannedMinutesValue: number | null,
    private debriefValue: FocusSessionDebrief,
    private readonly attachmentsValue: FocusSessionAttachments,
    readonly entryMode: EntryMode,
    readonly createdAt: Date,
  ) {
    if (endedAtValue !== null && endedAtValue <= startedAt) {
      throw new RangeError("A focus session must end after it started");
    }
    assertRating("focusQuality", debriefValue.focusQuality);
    assertRating("energy", debriefValue.energy);
  }

  /**
   * A live timer. Ends open, because that is the point of pressing start.
   *
   * `entryMode` is narrowed to the two live modes rather than the full set: `manual` and
   * `backfilled` are decided by `record` from the user's own clock, and a running session
   * cannot be either of them.
   */
  static start(input: {
    id: string;
    userId: string;
    intention: string | null;
    plannedMinutes: number | null;
    attachments: FocusSessionAttachments;
    entryMode: StartEntryMode;
    now: Date;
  }): FocusSession {
    return new FocusSession(
      input.id,
      input.userId,
      input.intention,
      input.now,
      null,
      input.plannedMinutes,
      EMPTY_DEBRIEF,
      input.attachments,
      input.entryMode,
      input.now,
    );
  }

  /**
   * Manual or retroactive entry (FR-F2).
   *
   * `entryMode` distinguishes something entered for today from something older, because
   * FR-F2 requires backfilled data to be *distinguishable without being second-class* — an
   * insight built only on timer sessions describes the days you remembered to press start,
   * which is a different population from the days you worked.
   */
  static record(input: {
    id: string;
    userId: string;
    intention: string | null;
    startedAt: Date;
    endedAt: Date;
    debrief: FocusSessionDebrief;
    attachments: FocusSessionAttachments;
    now: Date;
    /** IANA, from the profile. `entryMode` is a claim about *your* day, not about UTC's. */
    timeZone: string;
  }): FocusSession {
    // Rejected rather than clamped: both boundaries are the user's own claim, and moving one silently
    // would record a duration they did not enter. A block dated tomorrow otherwise sits at the top of
    // every recent list forever and counts toward a `focus_hours` goal for work that has not happened.
    if (input.startedAt > input.now) throw new SessionInFuture("startedAt");
    if (input.endedAt > input.now) throw new SessionInFuture("endedAt");

    return new FocusSession(
      input.id,
      input.userId,
      input.intention,
      input.startedAt,
      input.endedAt,
      null,
      input.debrief,
      input.attachments,
      isSameLocalDay(input.startedAt, input.now, input.timeZone) ? "manual" : "backfilled",
      input.now,
    );
  }

  /** From persistence. Invariants re-checked, because a row can be edited by hand. */
  static fromSnapshot(snapshot: FocusSessionSnapshot): FocusSession {
    return new FocusSession(
      snapshot.id,
      snapshot.userId,
      snapshot.intention,
      snapshot.startedAt,
      snapshot.endedAt,
      snapshot.plannedMinutes,
      {
        hitIntention: snapshot.hitIntention,
        focusQuality: snapshot.focusQuality,
        energy: snapshot.energy,
        note: snapshot.note,
      },
      { missionId: snapshot.missionId, lessonId: snapshot.lessonId },
      snapshot.entryMode,
      snapshot.createdAt,
    );
  }

  get isRunning(): boolean {
    return this.endedAtValue === null;
  }

  get endedAt(): Date | null {
    return this.endedAtValue;
  }

  get intention(): string | null {
    return this.intentionValue;
  }

  get debrief(): FocusSessionDebrief {
    return this.debriefValue;
  }

  get attachments(): FocusSessionAttachments {
    return this.attachmentsValue;
  }

  /** Null while running: a session in progress has an elapsed time, not a duration. */
  get minutes(): number | null {
    return this.endedAtValue === null ? null : elapsedMinutes(this.startedAt, this.endedAtValue);
  }

  /**
   * One tap, no arguments. Everything else waits for the debrief — §5.3 gives stopping five
   * seconds and the debrief thirty, and asking anything here spends the wrong budget.
   */
  stop(now: Date): void {
    if (!this.isRunning) throw new FocusSessionNotRunning(this.id);
    if (now <= this.startedAt) {
      // A clock correction mid-session, or a queued stop replayed out of order. Clamped to
      // one minute rather than rejected: the session genuinely happened, and refusing to
      // end it would leave a timer running forever.
      this.endedAtValue = new Date(this.startedAt.getTime() + 60_000);
      return;
    }
    this.endedAtValue = now;
  }

  /**
   * The ≤30s debrief (FR-F3). Merges rather than replaces, so answering one field now and
   * another later does not erase the first.
   */
  writeDebrief(patch: Partial<FocusSessionDebrief>): void {
    if (this.isRunning) throw new FocusSessionNotStopped(this.id);

    assertRating("focusQuality", patch.focusQuality ?? null);
    assertRating("energy", patch.energy ?? null);

    this.debriefValue = {
      hitIntention: patch.hitIntention ?? this.debriefValue.hitIntention,
      focusQuality: patch.focusQuality ?? this.debriefValue.focusQuality,
      energy: patch.energy ?? this.debriefValue.energy,
      // `note` is the one field a caller may want to clear, so undefined and null differ
      // here exactly as they do on a mission edit.
      note: patch.note === undefined ? this.debriefValue.note : patch.note,
    };
  }

  toSnapshot(): FocusSessionSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      intention: this.intentionValue,
      startedAt: this.startedAt,
      endedAt: this.endedAtValue,
      plannedMinutes: this.plannedMinutesValue,
      entryMode: this.entryMode,
      createdAt: this.createdAt,
      ...this.debriefValue,
      ...this.attachmentsValue,
    };
  }
}

const EMPTY_DEBRIEF: FocusSessionDebrief = {
  hitIntention: null,
  focusQuality: null,
  energy: null,
  note: null,
};

function assertRating(field: string, value: number | null): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError(`${field} must be an integer from 1 to 5, received ${value}`);
  }
}

/**
 * Compared in the user's timezone, which it was not until M2 was reviewed.
 *
 * It used to slice both instants' ISO strings, i.e. compare UTC days — so a São Paulo user recording
 * at 21:30 an entry for work finished at 20:00 the same evening got `backfilled`, because it was
 * already 00:30 UTC. Wrong for part of every day for every non-UTC user, against a repo rule that no
 * "day" derives from UTC or server-local time.
 *
 * The comment that stood here defended it as harmless and added that the values which *are* reported
 * on "come with M2". They have; the timezone is on `RequestContext` now, and the justification
 * expired with it. Kept below for the record, since the reasoning is still right about what
 * `entryMode` is for:
 * called `backfilled` instead of `manual` changes nothing anyone reads. Every value that
 * *is* reported on — daily rollups, the activity grid, "this week" — derives from the
 * profile's timezone (§5.2), and those come with M2.
 */
function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const zone = resolveTimeZone(timeZone);
  return localDay(a, zone) === localDay(b, zone);
}
