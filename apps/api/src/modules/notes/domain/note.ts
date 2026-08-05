import type { NoteLanguage, NoteLocator, NoteSubject } from "@mindforge/core";

export interface NoteSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly body: string;
  readonly subjectType: NoteSubject;
  readonly subjectId: string | null;
  /** Present when this note responds to an excerpt — i.e. it is a highlight (FR-N2). */
  readonly quote: string | null;
  readonly locator: NoteLocator | null;
  readonly pinned: boolean;
  readonly lang: NoteLanguage;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A note.
 *
 * Almost nothing to enforce beyond a non-empty body, and that is the design rather than an
 * omission: §6.14 makes notes *inputs* to the system, and every rule added here is a way for a
 * one-tap capture to fail. The one real invariant is that an attached note knows what it is
 * attached to — a note claiming to be on a mission with no mission id is unreachable from that
 * mission, so it is data that looks filed and is not.
 */
export class Note {
  private constructor(
    readonly id: string,
    readonly userId: string,
    private bodyValue: string,
    readonly subjectType: NoteSubject,
    readonly subjectId: string | null,
    private quoteValue: string | null,
    readonly locator: NoteLocator | null,
    private pinnedValue: boolean,
    readonly lang: NoteLanguage,
    readonly createdAt: Date,
    private updatedAtValue: Date,
  ) {
    assertBody(bodyValue);
    if (subjectType !== "standalone" && subjectId === null) {
      throw new RangeError(`A note on a ${subjectType} needs that ${subjectType}'s id`);
    }
  }

  static write(input: {
    id: string;
    userId: string;
    body: string;
    subjectType: NoteSubject;
    subjectId: string | null;
    quote: string | null;
    locator: NoteLocator | null;
    pinned: boolean;
    lang: NoteLanguage;
    now: Date;
  }): Note {
    return new Note(
      input.id,
      input.userId,
      input.body,
      input.subjectType,
      input.subjectId,
      input.quote,
      input.locator,
      input.pinned,
      input.lang,
      input.now,
      input.now,
    );
  }

  static fromSnapshot(snapshot: NoteSnapshot): Note {
    return new Note(
      snapshot.id,
      snapshot.userId,
      snapshot.body,
      snapshot.subjectType,
      snapshot.subjectId,
      snapshot.quote,
      snapshot.locator,
      snapshot.pinned,
      snapshot.lang,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get body(): string {
    return this.bodyValue;
  }

  get quote(): string | null {
    return this.quoteValue;
  }

  get pinned(): boolean {
    return this.pinnedValue;
  }

  get updatedAt(): Date {
    return this.updatedAtValue;
  }

  /** A note with a quote and a locator is a highlight (FR-N2) — derived, never a second column. */
  get isHighlight(): boolean {
    return this.quoteValue !== null;
  }

  /**
   * Edits in place. No revision history, unlike a mission: FR-N7 says edit history is not required,
   * and §6.14 rules out the archive features that would make one worth keeping.
   */
  edit(patch: { body?: string; quote?: string | null; pinned?: boolean }, now: Date): void {
    if (patch.body !== undefined) {
      assertBody(patch.body);
      this.bodyValue = patch.body;
    }
    if (patch.quote !== undefined) this.quoteValue = patch.quote;
    if (patch.pinned !== undefined) this.pinnedValue = patch.pinned;
    this.updatedAtValue = now;
  }

  toSnapshot(): NoteSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      body: this.bodyValue,
      subjectType: this.subjectType,
      subjectId: this.subjectId,
      quote: this.quoteValue,
      locator: this.locator,
      pinned: this.pinnedValue,
      lang: this.lang,
      createdAt: this.createdAt,
      updatedAt: this.updatedAtValue,
    };
  }
}

function assertBody(body: string): void {
  if (body.trim() === "") throw new RangeError("A note cannot be empty");
}
