import {
  MISSION_CONTENT_FIELDS,
  type MissionContentField,
  type MissionFields,
  type MissionStatus,
} from "@mindforge/core";
import { MissionNotActive, MissionNotParked } from "./errors.js";

/**
 * What an edit produced, for the append-only history (FR-M2).
 *
 * `previous` holds only the fields that actually changed. Storing the whole
 * mission every time would make the history bigger and the diff harder to read,
 * and the interesting question is always "what moved", never "what did the whole
 * thing look like".
 */
export interface MissionRevisionDraft {
  readonly missionId: string;
  readonly userId: string;
  readonly changedAt: Date;
  readonly reason: string;
  readonly changed: readonly MissionContentField[];
  readonly previous: Partial<MissionFields>;
}

/** Recorded when an edit arrives without one. See UpdateMissionSchema. */
export const UNSPECIFIED_REASON = "unspecified";

export interface MissionSnapshot extends MissionFields {
  readonly id: string;
  readonly userId: string;
  readonly status: MissionStatus;
  readonly workspaceKey: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A mission: the unit of intent everything else in the product hangs off.
 *
 * Invariants live here rather than only in the Zod schema, because the schema
 * guards one entry point. Seeds, the worker, and a future CLI import all
 * construct missions too, and a blank topic must be impossible from every one of
 * them.
 *
 * The WIP limit is deliberately *not* enforced here: it is a rule about the set
 * of a user's missions, not about one mission, and an entity that had to know how
 * many siblings it has would need a repository. It lives in the use cases.
 */
export class Mission {
  private constructor(
    readonly id: string,
    readonly userId: string,
    private topicValue: string,
    private whyValue: string | null,
    private successLooksLikeValue: string | null,
    private constraintsValue: string | null,
    private currentLevelValue: string | null,
    private statusValue: MissionStatus,
    private readonly workspaceKeyValue: string | null,
    readonly createdAt: Date,
    private updatedAtValue: Date,
  ) {
    assertTopic(topicValue);
  }

  static create(input: { id: string; userId: string; fields: MissionFields; now: Date }): Mission {
    return new Mission(
      input.id,
      input.userId,
      input.fields.topic,
      input.fields.why,
      input.fields.successLooksLike,
      input.fields.constraints,
      input.fields.currentLevel,
      // A mission is created because you intend to work on it now. Anything else
      // would be a draft, and this product has no use for drafts.
      "active",
      // Assigned when the teach workspace is first materialised (M3), never here:
      // the key is set once so that renaming a mission cannot move files.
      null,
      input.now,
      input.now,
    );
  }

  /** From persistence. Invariants are re-checked, because a row can be edited by hand. */
  static fromSnapshot(snapshot: MissionSnapshot): Mission {
    return new Mission(
      snapshot.id,
      snapshot.userId,
      snapshot.topic,
      snapshot.why,
      snapshot.successLooksLike,
      snapshot.constraints,
      snapshot.currentLevel,
      snapshot.status,
      snapshot.workspaceKey,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get status(): MissionStatus {
    return this.statusValue;
  }

  get workspaceKey(): string | null {
    return this.workspaceKeyValue;
  }

  get updatedAt(): Date {
    return this.updatedAtValue;
  }

  get fields(): MissionFields {
    return {
      topic: this.topicValue,
      why: this.whyValue,
      successLooksLike: this.successLooksLikeValue,
      constraints: this.constraintsValue,
      currentLevel: this.currentLevelValue,
    };
  }

  toSnapshot(): MissionSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      status: this.statusValue,
      workspaceKey: this.workspaceKeyValue,
      createdAt: this.createdAt,
      updatedAt: this.updatedAtValue,
      ...this.fields,
    };
  }

  /**
   * Applies an edit and returns the revision to append, or null when the body
   * changed nothing.
   *
   * Returning null rather than recording an empty revision matters: a history
   * padded with no-op entries stops being readable, and "this mission has drifted
   * eleven times" would become a statement about how often a form was submitted.
   */
  applyEdit(
    next: Partial<MissionFields>,
    reason: string | null,
    now: Date,
  ): MissionRevisionDraft | null {
    const before = this.fields;

    // Validated before anything is written, so a rejected edit leaves the entity
    // exactly as it was. Interleaving the two would make that depend on the order
    // fields happen to be iterated in.
    if (next.topic !== undefined) assertTopic(next.topic);

    const changed = MISSION_CONTENT_FIELDS.filter((field) => {
      const incoming = next[field];
      // `undefined` means "leave alone"; null means "clear". Treating them the
      // same would make an omitted field indistinguishable from a cleared one.
      return incoming !== undefined && incoming !== before[field];
    });

    if (changed.length === 0) return null;

    const previous: Partial<MissionFields> = {};
    for (const field of changed) {
      // Handled per field rather than through one index write, so the topic's
      // `string` and the prose fields' `string | null` stay distinct types.
      //
      // Both casts drop `undefined`, which the filter above already excluded. TS
      // cannot see through that predicate, so the cast records what is proven
      // rather than adding a fallback branch no input can reach.
      if (field === "topic") {
        previous.topic = before.topic;
        this.topicValue = next.topic as string;
      } else {
        previous[field] = before[field];
        this[proseSlot[field]] = next[field] as string | null;
      }
    }

    this.updatedAtValue = now;

    return {
      missionId: this.id,
      userId: this.userId,
      changedAt: now,
      reason: reason ?? UNSPECIFIED_REASON,
      changed,
      previous,
    };
  }

  /**
   * FR-M4b. Parking is not archiving: skills keep decaying, history keeps
   * counting, and only the *nagging* stops. Those consequences live with reviews
   * and notifications; here it is purely a status change.
   */
  park(now: Date): void {
    if (this.statusValue !== "active") throw new MissionNotActive(this.statusValue);
    this.statusValue = "parked";
    this.updatedAtValue = now;
  }

  unpark(now: Date): void {
    if (this.statusValue !== "parked") throw new MissionNotParked(this.statusValue);
    this.statusValue = "active";
    this.updatedAtValue = now;
  }
}

/** Maps a prose field to its private slot, so applyEdit can write it type-safely. */
const proseSlot = {
  why: "whyValue",
  successLooksLike: "successLooksLikeValue",
  constraints: "constraintsValue",
  currentLevel: "currentLevelValue",
} as const satisfies Record<Exclude<MissionContentField, "topic">, string>;

function assertTopic(topic: string): void {
  if (topic.trim() === "") {
    throw new RangeError("Mission topic cannot be blank");
  }
}
