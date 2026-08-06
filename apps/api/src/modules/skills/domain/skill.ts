import {
  bandFor,
  calibrationFor,
  fadedScore,
  featherFor,
  type Band,
  type Calibration,
  type Feather,
} from "@mindforge/core";

export interface SkillSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  /** Self-rating, 0–100. Null means you have not said. */
  readonly perceivedLevel: number | null;
  /** From evidence only. Null means unproven — never 0, which is a different claim. */
  readonly score: number | null;
  readonly scoreStdDev: number | null;
  readonly halfLifeDays: number;
  readonly lastEvidenceAt: Date | null;
  readonly createdAt: Date;
}

/**
 * A skill (FR-S1..S6).
 *
 * The invariant the class exists to hold: **there is no way to set `score`.** It has no setter, and
 * `rate()` writes only `perceivedLevel`. A score is computed from evidence (FR-S2), and the moment a
 * self-rating could move it the calibration gap would measure nothing — the two terms would rise
 * together by construction.
 *
 * `band` is derived rather than stored, for the same reason: a stored band is a second copy of the
 * score that goes stale the day decay moves it, and FR-S4's whole point is that it moves on its own.
 */
export class Skill {
  private nameValue: string;
  private slugValue: string;
  private descriptionValue: string | null;
  private perceivedLevelValue: number | null;
  private halfLifeDaysValue: number;

  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly createdAt: Date,
    /** Evidence-derived, and deliberately readonly from this class's point of view. */
    readonly score: number | null,
    readonly scoreStdDev: number | null,
    readonly lastEvidenceAt: Date | null,
    snapshot: Pick<
      SkillSnapshot,
      "name" | "slug" | "description" | "perceivedLevel" | "halfLifeDays"
    >,
  ) {
    this.nameValue = requireName(snapshot.name);
    this.slugValue = snapshot.slug;
    this.descriptionValue = snapshot.description;
    this.perceivedLevelValue = requireLevel(snapshot.perceivedLevel);
    this.halfLifeDaysValue = snapshot.halfLifeDays;
  }

  static create(input: {
    id: string;
    userId: string;
    name: string;
    slug: string;
    description: string | null;
    perceivedLevel: number | null;
    now: Date;
  }): Skill {
    return new Skill(input.id, input.userId, input.now, null, null, null, {
      name: input.name,
      slug: input.slug,
      description: input.description,
      perceivedLevel: input.perceivedLevel,
      // The default from §3: adjustable per skill, because a language you speak daily fades slower
      // than a library API.
      halfLifeDays: 90,
    });
  }

  static fromSnapshot(snapshot: SkillSnapshot): Skill {
    return new Skill(
      snapshot.id,
      snapshot.userId,
      snapshot.createdAt,
      snapshot.score,
      snapshot.scoreStdDev,
      snapshot.lastEvidenceAt,
      snapshot,
    );
  }

  get name(): string {
    return this.nameValue;
  }
  get slug(): string {
    return this.slugValue;
  }
  get description(): string | null {
    return this.descriptionValue;
  }
  get perceivedLevel(): number | null {
    return this.perceivedLevelValue;
  }
  get halfLifeDays(): number {
    return this.halfLifeDaysValue;
  }

  /**
   * The score as of now, faded (FR-S4).
   *
   * This — not the stored value — is what every read reports and what goal targets compare against.
   * A skill you have not touched in six months should visibly fade, and a stored figure would say it
   * had not.
   */
  currentScore(now: Date): number | null {
    return fadedScore(this.score, this.lastEvidenceAt, now, this.halfLifeDaysValue);
  }

  /** Derived from the decayed score, so it moves without anything being written. */
  currentBand(now: Date): Band | null {
    return bandFor(this.currentScore(now));
  }

  /** How crisply to draw the gauge — uncertainty as feathered edges rather than a footnote (§9.1). */
  feather(now: Date): Feather {
    return featherFor(this.lastEvidenceAt, now);
  }

  /**
   * The calibration gap (FR-S5), against the **decayed** score.
   *
   * Comparing a self-rating with a year-stale figure would measure how long ago you learned something,
   * not how well you know it now.
   */
  calibration(now: Date): Calibration {
    return calibrationFor(this.perceivedLevelValue, this.currentScore(now));
  }

  /**
   * The self-rating, and the only number a person can set here (FR-S2).
   *
   * Recorded rather than trusted: it never reaches `score`, and its whole purpose is to be compared
   * against evidence that disagrees with it.
   */
  rate(perceivedLevel: number | null): void {
    this.perceivedLevelValue = requireLevel(perceivedLevel);
  }

  edit(changes: {
    name?: string;
    slug?: string;
    description?: string | null;
    perceivedLevel?: number | null;
    halfLifeDays?: number;
  }): void {
    if (changes.name !== undefined) this.nameValue = requireName(changes.name);
    if (changes.slug !== undefined) this.slugValue = changes.slug;
    if (changes.description !== undefined) this.descriptionValue = changes.description;
    if (changes.perceivedLevel !== undefined) this.rate(changes.perceivedLevel);
    if (changes.halfLifeDays !== undefined) {
      this.halfLifeDaysValue = requireHalfLife(changes.halfLifeDays);
    }
  }

  toSnapshot(): SkillSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      name: this.nameValue,
      slug: this.slugValue,
      description: this.descriptionValue,
      perceivedLevel: this.perceivedLevelValue,
      score: this.score,
      scoreStdDev: this.scoreStdDev,
      halfLifeDays: this.halfLifeDaysValue,
      lastEvidenceAt: this.lastEvidenceAt,
      createdAt: this.createdAt,
    };
  }
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new RangeError("a skill needs a name");
  return trimmed;
}

function requireLevel(level: number | null): number | null {
  if (level === null) return null;
  if (!Number.isFinite(level) || level < 0 || level > 100) {
    throw new RangeError(`a self-rating must be 0–100, received ${level}`);
  }
  return level;
}

/**
 * Bounded so decay cannot be switched off.
 *
 * An effectively infinite half-life is a way to make the dashboard flatter without knowing more, which
 * is the one thing FR-S4 exists to prevent.
 */
function requireHalfLife(days: number): number {
  if (!Number.isFinite(days) || days < 7 || days > 730) {
    throw new RangeError(`a half-life must be 7–730 days, received ${days}`);
  }
  return days;
}
