import { UuidSchema, type NotificationKind } from "@mindforge/core";
import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import { DismissNotification, ListNotifications } from "../application/account.use-cases.js";
import type { Notification, NotificationPayload } from "../domain/notification.js";

export interface NotificationView {
  readonly id: string;
  /** A message key. The SPA translates it at render, like every other string (§5.2). */
  readonly kind: NotificationKind;
  /**
   * ICU arguments for the message keyed by `kind`, passed through as-is.
   *
   * Not typed per kind here on purpose: the shape belongs to the message, the message lives in the
   * SPA's bundle, and a mirror of it in this file would be a second place to update every time a
   * nudge gains an argument.
   */
  readonly payload: NotificationPayload;
  /** What tapping it opens. Null for a nudge about the week rather than about a thing. */
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly createdAt: string;
  readonly dismissedAt: string | null;
}

export function toNotificationView(notification: Notification): NotificationView {
  const n = notification.toSnapshot();
  return {
    id: n.id,
    kind: n.kind,
    payload: n.payload,
    subjectType: n.subjectType,
    subjectId: n.subjectId,
    createdAt: n.createdAt.toISOString(),
    dismissedAt: n.dismissedAt?.toISOString() ?? null,
  };
}

/**
 * `/v1/notifications` (FR-N1, FR-N3, FR-N4).
 *
 * In the account module rather than one of its own: these are things about *you*, they share a
 * settings table with `/v1/me/notification-prefs`, and a module with two endpoints and no domain of
 * its own would be ceremony.
 *
 * There is no create endpoint. Nudges are raised by the nightly job (M3) against a dedupe key that
 * is what makes the job safe to re-run — a client that could raise its own would make that key mean
 * nothing.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly list: ListNotifications,
    private readonly dismissOne: DismissNotification,
  ) {}

  /**
   * Undismissed, newest first.
   *
   * The only list there is: FR-N5 rules out anything that accumulates into a backlog of things you
   * failed to act on, so a dismissed nudge is gone rather than archived somewhere you can browse.
   */
  @Get()
  async listMine(
    @CurrentUser() user: RequestContext,
  ): Promise<{ notifications: NotificationView[] }> {
    const notifications = await this.list.execute(user.userId);
    return { notifications: notifications.map(toNotificationView) };
  }

  /**
   * 200 rather than 201 — nothing is created — and the dismissed row comes back so a client that
   * replayed the tap offline can see the timestamp it actually landed on.
   */
  @Post(":id/dismiss")
  @HttpCode(200)
  async dismiss(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<NotificationView> {
    return toNotificationView(await this.dismissOne.execute(user.userId, id));
  }
}
