import {
  goalProgress,
  type GoalProgress,
  type GoalStatus,
  type TargetEvidence,
} from "@mindforge/core";
import { GoalAlreadyClosed, GoalNotClosed } from "./errors.js";
import type { GoalTarget } from "./goal-target.js";

export interface GoalSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly missionId: string | null;
  readonly title: string;
  readonly definitionOfDone: string | null;
  /** A calendar day, `YYYY-MM-DD` — not an instant. See the schema's note. */
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly outcomeNote: string | null;
  readonly createdAt: Date;
}

/** Evidence for a whole goal, keyed by target id — assembled once per read. */
export type GoalEvidence = Readonly<Record<string, TargetEvidence>>;

/**
 * A goal and its targets (FR-M3).
 *
 * There is no progress column and no setter for one. The number the user sees is computed from the
 * targets every time it is asked for, because the alternative — storing it — means a value that was
 * true once and is now quietly wrong, which §3.8 exists to prevent.
 *
 * `status` is a separate matter from progress and is deliberately *not* derived. A goal whose targets
 * are all met is not automatically `met`: closing a goal is a decision a person makes, and auto-closing
 * would rob them of the outcome note that makes the record worth keeping. What the app does instead is
 * say "every target is met — close it?".
 */
export class Goal {
  private statusValue: GoalStatus;
  private outcomeNoteValue: string | null;
  private titleValue: string;
  private definitionOfDoneValue: string | null;
  private targetDateValue: string | null;
  private missionIdValue: string | null;
  private targetList: GoalTarget[];

  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly createdAt: Date,
    snapshot: Omit<GoalSnapshot, "id" | "userId" | "createdAt">,
    targets: readonly GoalTarget[],
  ) {
    this.titleValue = requireTitle(snapshot.title);
    this.definitionOfDoneValue = snapshot.definitionOfDone;
    this.targetDateValue = snapshot.targetDate;
    this.missionIdValue = snapshot.missionId;
    this.statusValue = snapshot.status;
    this.outcomeNoteValue = snapshot.outcomeNote;
    this.targetList = [...targets];
  }

  static create(input: {
    id: string;
    userId: string;
    missionId: string | null;
    title: string;
    definitionOfDone: string | null;
    targetDate: string | null;
    now: Date;
  }): Goal {
    return new Goal(
      input.id,
      input.userId,
      input.now,
      {
        missionId: input.missionId,
        title: input.title,
        definitionOfDone: input.definitionOfDone,
        targetDate: input.targetDate,
        status: "active",
        outcomeNote: null,
      },
      [],
    );
  }

  static fromSnapshot(snapshot: GoalSnapshot, targets: readonly GoalTarget[] = []): Goal {
    return new Goal(snapshot.id, snapshot.userId, snapshot.createdAt, snapshot, targets);
  }

  get title(): string {
    return this.titleValue;
  }
  get definitionOfDone(): string | null {
    return this.definitionOfDoneValue;
  }
  get targetDate(): string | null {
    return this.targetDateValue;
  }
  get missionId(): string | null {
    return this.missionIdValue;
  }
  get status(): GoalStatus {
    return this.statusValue;
  }
  get outcomeNote(): string | null {
    return this.outcomeNoteValue;
  }
  get targets(): readonly GoalTarget[] {
    return this.targetList;
  }
  get isClosed(): boolean {
    return this.statusValue !== "active";
  }

  addTarget(target: GoalTarget): void {
    this.targetList.push(target);
  }

  removeTarget(id: string): void {
    this.targetList = this.targetList.filter((target) => target.id !== id);
  }

  findTarget(id: string): GoalTarget | undefined {
    return this.targetList.find((target) => target.id === id);
  }

  /**
   * No `now` parameter, unlike a mission's edit: `goals` has a `created_at` and no `updated_at`, so
   * there is nothing to stamp. Taking a clock it did not use would imply otherwise.
   */
  edit(changes: {
    title?: string;
    definitionOfDone?: string | null;
    targetDate?: string | null;
    missionId?: string | null;
  }): void {
    // A closed goal is a record of what happened. Editing its title after the fact would rewrite the
    // history that makes the outcome note meaningful.
    if (this.isClosed) throw new GoalAlreadyClosed(this.id, this.statusValue);

    if (changes.title !== undefined) this.titleValue = requireTitle(changes.title);
    if (changes.definitionOfDone !== undefined) {
      this.definitionOfDoneValue = changes.definitionOfDone;
    }
    if (changes.targetDate !== undefined) this.targetDateValue = changes.targetDate;
    if (changes.missionId !== undefined) this.missionIdValue = changes.missionId;
  }

  /**
   * Closing a goal, including missing one.
   *
   * `missed` and `abandoned` are first-class outcomes rather than failures to hide — a goal that is
   * allowed to fail is a goal you will write down honestly next time, and the note is the part that
   * has any value later.
   */
  close(status: Exclude<GoalStatus, "active">, outcomeNote: string | null): void {
    if (this.isClosed) throw new GoalAlreadyClosed(this.id, this.statusValue);

    this.statusValue = status;
    this.outcomeNoteValue = outcomeNote;
  }

  /** Explicit, so a stray edit cannot resurrect something you decided to stop. */
  reopen(): void {
    if (!this.isClosed) throw new GoalNotClosed(this.id);

    this.statusValue = "active";
    // Cleared: the note described why it ended, and it did not end.
    this.outcomeNoteValue = null;
  }

  /** The weighted mean over the targets, computed fresh (§3.8). */
  progress(evidence: GoalEvidence = {}): GoalProgress {
    return goalProgress(
      this.targetList.map((target) => ({
        definition: target.definition,
        weight: target.weight,
        // Through the target, not raw: only it knows whether a manual one is ticked and which band a
        // skill target started from, and skipping that made a ticked target read as unmet here.
        evidence: target.evidenceFrom(evidence[target.id] ?? {}),
      })),
    );
  }

  /**
   * Recomputes every target and stamps the ones that changed.
   *
   * Returns whether anything moved, so a caller can skip a write — this runs on every mutation that
   * touches a source and nightly across every goal, and most of the time nothing has changed.
   */
  observe(evidence: GoalEvidence, now: Date): boolean {
    let changed = false;
    for (const target of this.targetList) {
      const before = target.metAt?.getTime() ?? null;
      target.observe(evidence[target.id] ?? {}, now);
      if ((target.metAt?.getTime() ?? null) !== before) changed = true;
    }
    return changed;
  }

  toSnapshot(): GoalSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      missionId: this.missionIdValue,
      title: this.titleValue,
      definitionOfDone: this.definitionOfDoneValue,
      targetDate: this.targetDateValue,
      status: this.statusValue,
      outcomeNote: this.outcomeNoteValue,
      createdAt: this.createdAt,
    };
  }
}

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") throw new RangeError("a goal needs a title");
  return trimmed;
}
