import type { IsoDate } from "@mindforge/core";

/**
 * The ritual happened (FR-F6).
 *
 * A record rather than an entity, and deliberately so: there is no rule here to protect. A review
 * cannot be in a wrong state, cannot conflict with another, and has no operation but "it happened,
 * and here is what I decided" — CLAUDE.md's architecture rules say a CRUD-ish thing stays thin, and a
 * class with four getters and no invariant would be ceremony charging rent.
 *
 * `changedOneThing` is nullable because a week where nothing needs changing is a real answer (§7.2:
 * forcing a sentence produces a fabricated one). It is a column of its own rather than a line in the
 * note because NORTHSTAR §4's M2 finish line — "three weekly reviews and changed one thing because of
 * one" — is only observable if it is queryable.
 */
export interface WeeklyReview {
  readonly id: string;
  readonly userId: string;
  /** Already normalised to the user's week start. */
  readonly weekStart: IsoDate;
  readonly completedAt: Date;
  readonly changedOneThing: string | null;
  readonly note: string | null;
}
