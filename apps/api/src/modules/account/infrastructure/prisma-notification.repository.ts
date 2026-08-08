import { NOTIFICATION_KINDS, type NotificationKind, type NotificationPref } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { StoredNotificationPref } from "../domain/notification-prefs.js";
import { Notification, type NotificationPayload } from "../domain/notification.js";
import type { NotificationRepository } from "../domain/notification.repository.js";

const COLUMNS = {
  id: true,
  userId: true,
  kind: true,
  payload: true,
  subjectType: true,
  subjectId: true,
  createdAt: true,
  dismissedAt: true,
} as const;

interface NotificationRow {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: Date;
  dismissedAt: Date | null;
}

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  listUndismissed(userId: string): Promise<Notification[]> {
    return this.db.run(userId, async (tx) => {
      const rows = await tx.notification.findMany({
        where: { dismissedAt: null },
        // `created_at` is a timestamptz, so ordering it in SQL is genuinely chronological — unlike
        // the enum-ish text columns elsewhere in this codebase, which have to be ranked in
        // TypeScript. Uses the (user_id, dismissed_at, created_at) index.
        orderBy: { createdAt: "desc" },
        select: COLUMNS,
      });
      return rows.flatMap(toNotification);
    });
  }

  findById(userId: string, id: string): Promise<Notification | null> {
    return this.db.run(userId, async (tx) => {
      const row = await tx.notification.findUnique({ where: { id }, select: COLUMNS });
      return row ? (toNotification(row)[0] ?? null) : null;
    });
  }

  save(userId: string, notification: Notification): Promise<void> {
    const n = notification.toSnapshot();
    return this.db.run(userId, async (tx) => {
      // Only the mutable column, and no upsert: raising a notification belongs to the nightly job.
      // `updateMany` because a row RLS hides is simply not updated, rather than a P2025 for a row
      // the use case has already reported as missing.
      await tx.notification.updateMany({
        where: { id: n.id },
        data: { dismissedAt: n.dismissedAt },
      });
    });
  }

  prefs(userId: string): Promise<readonly StoredNotificationPref[]> {
    return this.db.run(userId, (tx) =>
      tx.notificationPref.findMany({ select: { kind: true, enabled: true, config: true } }),
    );
  }

  savePrefs(userId: string, prefs: readonly NotificationPref[]): Promise<void> {
    return this.db.run(userId, async (tx) => {
      for (const pref of prefs) {
        await tx.notificationPref.upsert({
          // The compound primary key, so `userId` appears as part of the key rather than as a
          // scoping predicate. RLS is still what stops this addressing anyone else's row.
          where: { userId_kind: { userId, kind: pref.kind } },
          create: { userId, kind: pref.kind, enabled: pref.enabled, config: pref.config },
          update: { enabled: pref.enabled, config: pref.config },
        });
        // Sequentially rather than through Promise.all: these share one transaction on one
        // connection, so concurrency buys nothing over at most two rows and makes the failure
        // interleaving harder to reason about.
      }
    });
  }
}

const KNOWN: ReadonlySet<string> = new Set(NOTIFICATION_KINDS);

function isNotificationKind(value: string): value is NotificationKind {
  return KNOWN.has(value);
}

/**
 * Returns zero or one notification, so callers can `flatMap` unknown kinds away.
 *
 * A kind this build cannot translate would render as a raw message key, which is worse than not
 * appearing — so it is dropped from the list, and by the same rule `findById` treats it as missing.
 * That pair is consistent: a nudge you cannot see is not one you can dismiss, and the row survives
 * for the build that understands it. Unreachable today (the table has a CHECK constraint on `kind`)
 * and cheap insurance against the migration that widens it while an older API is still deployed.
 */
function toNotification(row: NotificationRow): Notification[] {
  if (!isNotificationKind(row.kind)) return [];

  return [
    Notification.fromSnapshot({
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      payload: toPayload(row.payload),
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      createdAt: row.createdAt,
      dismissedAt: row.dismissedAt,
    }),
  ];
}

/**
 * jsonb can hold a scalar or an array, and the column defaults to `{}`.
 *
 * ICU arguments are an object or nothing, so anything else becomes no arguments: a nudge whose
 * payload is unreadable still says what kind it is, which is the part that carries the meaning.
 */
function toPayload(value: unknown): NotificationPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as NotificationPayload)
    : {};
}
