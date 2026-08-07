import {
  defaultNotificationPrefs,
  localDay,
  NotificationPrefSchema,
  resolveTimeZone,
  type Clock,
  type IsoDate,
  type NotificationPref,
  type StallCandidate,
  type WeekStart,
} from "@mindforge/core";
import { rebuildDailyActivity, type PrismaClient } from "@mindforge/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLOCK } from "../../../shared/clock.js";
import { PRISMA } from "../../../shared/prisma.js";
import type {
  NightlyGateway,
  NightlyProfile,
  RaisedNotification,
} from "../application/nightly.port.js";

/**
 * The worker's database access.
 *
 * **Every query names its user explicitly.** This connection bypasses RLS entirely — that is what a
 * background job needs and it is also what makes CLAUDE.md's first non-negotiable load-bearing here
 * rather than decorative. `listProfiles` is the single sanctioned cross-user read, and everything
 * downstream is scoped by the id it returned.
 */
@Injectable()
export class PrismaNightlyGateway implements NightlyGateway {
  private readonly logger = new Logger(PrismaNightlyGateway.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listProfiles(): Promise<readonly NightlyProfile[]> {
    const rows = await this.prisma.profile.findMany({
      select: { id: true, timezone: true, weekStartsOn: true },
    });

    return rows.map((row) => ({
      userId: row.id,
      // Coerced here rather than trusted. A zone Intl no longer knows would throw inside the
      // formatter and take down this user's whole run; falling back to UTC makes their grid wrong
      // until they fix the setting, which is a far better failure.
      timezone: resolveTimeZone(row.timezone),
      weekStartsOn: (row.weekStartsOn === 0 ? 0 : 1) satisfies WeekStart,
    }));
  }

  async rollUp(
    userId: string,
    timezone: string,
    range: { readonly from: IsoDate; readonly to: IsoDate },
  ): Promise<{ readonly daysWritten: number }> {
    return rebuildDailyActivity(this.prisma, userId, timezone, range, this.clock.now());
  }

  async stallCandidates(userId: string, timezone: string): Promise<readonly StallCandidate[]> {
    const missions = await this.prisma.mission.findMany({
      // Active only. Parking a mission is how you answer the question this nudge asks, so asking it
      // again about a parked one is the app not listening (§5.3).
      where: { userId, status: "active" },
      select: {
        id: true,
        createdAt: true,
        sessions: { select: { startedAt: true }, orderBy: { startedAt: "desc" }, take: 1 },
      },
    });

    return missions.map((mission) => ({
      missionId: mission.id,
      createdOn: localDay(mission.createdAt, timezone),
      lastSessionOn:
        mission.sessions[0] === undefined
          ? null
          : localDay(mission.sessions[0].startedAt, timezone),
    }));
  }

  async missionTopics(
    userId: string,
    missionIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (missionIds.length === 0) return new Map();
    const rows = await this.prisma.mission.findMany({
      where: { userId, id: { in: [...missionIds] } },
      select: { id: true, topic: true },
    });
    return new Map(rows.map((row) => [row.id, row.topic]));
  }

  async notificationPrefs(userId: string): Promise<readonly NotificationPref[]> {
    const stored = await this.prisma.notificationPref.findMany({
      where: { userId },
      select: { kind: true, enabled: true, config: true },
    });

    const byKind = new Map<string, NotificationPref>();
    for (const row of stored) {
      const parsed = NotificationPrefSchema.safeParse({
        kind: row.kind,
        enabled: row.enabled,
        config: row.config,
      });
      // A row written by an older version of the app, or hand-edited, falls back to the default
      // rather than throwing. Refusing to run the whole nightly job over one malformed preference
      // would be the wrong trade — and silently treating it as "off" would be worse, because the
      // user would never learn why their nudges stopped.
      if (parsed.success) byKind.set(row.kind, parsed.data);
      else this.logger.warn(`Ignoring malformed notification_prefs row (${userId}, ${row.kind})`);
    }

    // Merged over the defaults at read time, never seeded into the table: a future change to a
    // default then reaches existing users, which a seeded row would have frozen out.
    return defaultNotificationPrefs().map((fallback) => byKind.get(fallback.kind) ?? fallback);
  }

  async raise(notifications: readonly RaisedNotification[]): Promise<number> {
    if (notifications.length === 0) return 0;

    const result = await this.prisma.notification.createMany({
      data: notifications.map((notification) => ({
        userId: notification.userId,
        kind: notification.kind,
        dedupeKey: notification.dedupeKey,
        payload: notification.payload,
        subjectType: notification.subjectType,
        subjectId: notification.subjectId,
        createdAt: this.clock.now(),
      })),
      // The unique index on (user_id, dedupe_key) is the deduplication, and this is what turns a
      // conflict into a no-op instead of an exception. A check-then-insert would look equivalent
      // and lose the race two overlapping ticks create.
      skipDuplicates: true,
    });

    return result.count;
  }
}
