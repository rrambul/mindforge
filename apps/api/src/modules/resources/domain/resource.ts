import {
  UNIT_FOR_TYPE,
  type ResourceProgress,
  type ResourceStatus,
  type ResourceType,
} from "@mindforge/core";
import { ProgressOutOfRange, ResourceHasNoProgress } from "./errors.js";

export interface ResourceSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly type: ResourceType;
  readonly title: string;
  readonly author: string | null;
  readonly url: string | null;
  readonly status: ResourceStatus;
  readonly abandonReason: string | null;
  readonly progress: ResourceProgress | null;
  readonly addedAt: Date;
  readonly finishedAt: Date | null;
}

/**
 * Something you are learning from.
 *
 * The rules here are about keeping the *status* honest, because status is what the backlog-health
 * insight (FR-R6, M2) will be computed from. Marking progress moves a resource into `active` on its
 * own: the alternative is a library full of things sitting in `queued` that you are demonstrably
 * reading, which would make "queue growth vs. throughput" a measurement of your triage habits rather
 * than of your reading.
 */
export class Resource {
  private constructor(
    readonly id: string,
    readonly userId: string,
    private typeValue: ResourceType,
    private titleValue: string,
    private authorValue: string | null,
    readonly url: string | null,
    private statusValue: ResourceStatus,
    private abandonReasonValue: string | null,
    private progressValue: ResourceProgress | null,
    readonly addedAt: Date,
    private finishedAtValue: Date | null,
  ) {
    assertTitle(titleValue);
  }

  static add(input: {
    id: string;
    userId: string;
    type: ResourceType;
    title: string;
    author: string | null;
    url: string | null;
    status: ResourceStatus;
    now: Date;
  }): Resource {
    return new Resource(
      input.id,
      input.userId,
      input.type,
      input.title,
      input.author,
      input.url,
      input.status,
      null,
      // Seeded so a captured resource is immediately markable — a first progress update should not
      // have to also declare what unit the thing is measured in.
      startingProgress(input.type),
      input.now,
      null,
    );
  }

  static fromSnapshot(snapshot: ResourceSnapshot): Resource {
    return new Resource(
      snapshot.id,
      snapshot.userId,
      snapshot.type,
      snapshot.title,
      snapshot.author,
      snapshot.url,
      snapshot.status,
      snapshot.abandonReason,
      snapshot.progress,
      snapshot.addedAt,
      snapshot.finishedAt,
    );
  }

  get type(): ResourceType {
    return this.typeValue;
  }
  get title(): string {
    return this.titleValue;
  }
  get author(): string | null {
    return this.authorValue;
  }
  get status(): ResourceStatus {
    return this.statusValue;
  }
  get abandonReason(): string | null {
    return this.abandonReasonValue;
  }
  get progress(): ResourceProgress | null {
    return this.progressValue;
  }
  get finishedAt(): Date | null {
    return this.finishedAtValue;
  }

  /** Whether this kind of thing is measured at all (FR-R1). */
  get isMeasurable(): boolean {
    return UNIT_FOR_TYPE[this.typeValue] !== "none";
  }

  edit(
    patch: {
      title?: string;
      author?: string | null;
      type?: ResourceType;
      status?: ResourceStatus;
    },
    now: Date,
  ): void {
    if (patch.title !== undefined) {
      assertTitle(patch.title);
      this.titleValue = patch.title;
    }
    if (patch.author !== undefined) this.authorValue = patch.author;

    if (patch.type !== undefined && patch.type !== this.typeValue) {
      this.typeValue = patch.type;
      // A retyped resource is measured differently, so its old position is meaningless — a page
      // number on something now known to be a podcast would be a figure with no referent.
      this.progressValue = startingProgress(patch.type);
    }

    if (patch.status !== undefined) this.setStatus(patch.status, now);
  }

  /**
   * A capture path: you mark a page as you close the book (§5.1), so it takes only the position.
   *
   * Moves the resource to `active` if it was merely captured or queued — see the class note.
   */
  markProgress(current: number, total: number | null | undefined, now: Date): void {
    if (!this.isMeasurable) throw new ResourceHasNoProgress(this.typeValue);

    const unit = UNIT_FOR_TYPE[this.typeValue];
    const resolvedTotal = total === undefined ? (this.progressValue?.total ?? null) : total;

    if (current < 0 || (resolvedTotal !== null && current > resolvedTotal)) {
      throw new ProgressOutOfRange(current, resolvedTotal, unit);
    }

    this.progressValue = { unit, current, total: resolvedTotal };

    if (this.statusValue === "inbox" || this.statusValue === "queued") {
      this.setStatus("active", now);
    }
  }

  finish(now: Date): void {
    this.setStatus("finished", now);
  }

  /**
   * FR-R5 — first-class and guilt-free, and the reason is optional.
   *
   * Requiring a justification to stop reading something turns quitting into a confession, and the
   * predictable result is items that sit in `active` forever. That is worse data than an abandonment
   * with no reason attached.
   */
  abandon(reason: string | null, now: Date): void {
    this.abandonReasonValue = reason;
    this.setStatus("abandoned", now);
  }

  private setStatus(status: ResourceStatus, now: Date): void {
    this.statusValue = status;

    // Stamped on the way in and cleared on the way out, so `finishedAt` can never describe something
    // that is no longer finished — which is exactly the kind of stale field a "finished this month"
    // rollup would read without questioning.
    this.finishedAtValue = status === "finished" ? now : null;

    // Cleared when a resource comes back from being abandoned. People do return to books, and a
    // stale "too shallow" on something you are now reading would poison the abandonment analysis
    // FR-R5 exists to enable.
    if (status !== "abandoned") this.abandonReasonValue = null;
  }

  toSnapshot(): ResourceSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      type: this.typeValue,
      title: this.titleValue,
      author: this.authorValue,
      url: this.url,
      status: this.statusValue,
      abandonReason: this.abandonReasonValue,
      progress: this.progressValue,
      addedAt: this.addedAt,
      finishedAt: this.finishedAtValue,
    };
  }
}

/** Null for the unmeasurable types, so their progress column stays honestly empty. */
function startingProgress(type: ResourceType): ResourceProgress | null {
  const unit = UNIT_FOR_TYPE[type];
  return unit === "none" ? null : { unit, current: 0, total: null };
}

function assertTitle(title: string): void {
  if (title.trim() === "") throw new RangeError("A resource needs a title");
}
