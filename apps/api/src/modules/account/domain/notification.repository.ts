import type { NotificationPref } from "@mindforge/core";
import type { StoredNotificationPref } from "./notification-prefs.js";
import type { Notification } from "./notification.js";

export const NOTIFICATION_REPOSITORY = Symbol("NotificationRepository");

export interface NotificationRepository {
  /**
   * Undismissed, newest first — the only list the product has.
   *
   * A dismissed nudge is not archived anywhere the user can reach: FR-N5 rules out anything that
   * accumulates into a backlog of things you failed to act on.
   */
  listUndismissed(userId: string): Promise<Notification[]>;

  findById(userId: string, id: string): Promise<Notification | null>;

  /**
   * Writes back the one mutable column.
   *
   * Deliberately not an upsert, unlike every other `save` in this codebase: notifications are
   * *raised* by the nightly job (M3), never by a request. An endpoint that could create one would
   * let a client fabricate its own nudges, and the dedupe key that makes the job safe to re-run
   * would stop meaning anything.
   */
  save(userId: string, notification: Notification): Promise<void>;

  /**
   * The caller's stored preference rows, unparsed.
   *
   * Prefs live on this repository rather than one of their own: they are the settings *for* these
   * notifications, they are keyed by the same `kind`, and a third token would be ceremony over two
   * columns.
   */
  prefs(userId: string): Promise<readonly StoredNotificationPref[]>;

  /** Upserts the given kinds and leaves the others alone. Absence is itself a setting. */
  savePrefs(userId: string, prefs: readonly NotificationPref[]): Promise<void>;
}
