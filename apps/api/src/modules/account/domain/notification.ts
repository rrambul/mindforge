import type { NotificationKind } from "@mindforge/core";

/**
 * ICU arguments for the message keyed by `kind` — never rendered text.
 *
 * A notification with English baked into the row is one that cannot be read in pt-BR, which is why
 * the column holds arguments and the SPA translates at render like every other string (§5.2).
 */
export type NotificationPayload = Readonly<Record<string, unknown>>;

export interface NotificationSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly payload: NotificationPayload;
  /** What tapping it should open. Null for a nudge about the week rather than about a thing. */
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly createdAt: Date;
  readonly dismissedAt: Date | null;
}

/**
 * A nudge that has been raised and not yet dismissed (FR-N1, FR-N3).
 *
 * `dedupeKey` and `seenAt` are columns this entity deliberately does not carry. The dedupe key
 * belongs to the nightly job that raises these (M3) and means nothing on the read path; `seenAt` is
 * written by nothing in M2, and an entity field that is permanently null invites a client to build
 * an unseen marker on a column no code sets.
 */
export class Notification {
  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly kind: NotificationKind,
    readonly payload: NotificationPayload,
    readonly subjectType: string | null,
    readonly subjectId: string | null,
    readonly createdAt: Date,
    private dismissedAtValue: Date | null,
  ) {}

  get dismissedAt(): Date | null {
    return this.dismissedAtValue;
  }

  /**
   * Idempotent: a second dismiss keeps the first timestamp.
   *
   * Dismissing is a tap, so it travels through the offline queue and arrives twice as a matter of
   * course (§6.1). Moving the timestamp on the replay would make "when did you stop wanting to see
   * this" a record of when the network came back.
   */
  dismiss(now: Date): void {
    this.dismissedAtValue ??= now;
  }

  static fromSnapshot(snapshot: NotificationSnapshot): Notification {
    return new Notification(
      snapshot.id,
      snapshot.userId,
      snapshot.kind,
      snapshot.payload,
      snapshot.subjectType,
      snapshot.subjectId,
      snapshot.createdAt,
      snapshot.dismissedAt,
    );
  }

  toSnapshot(): NotificationSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      kind: this.kind,
      payload: this.payload,
      subjectType: this.subjectType,
      subjectId: this.subjectId,
      createdAt: this.createdAt,
      dismissedAt: this.dismissedAt,
    };
  }
}
