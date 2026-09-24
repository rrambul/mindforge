import { resolveBridges } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { judgeLessons } from "../../exercises/infrastructure/judge-lessons.js";
import type { LessonLanding, LessonLandingReader } from "../application/lesson-landing.port.js";

/**
 * One lesson's verdict and whether it already has a bridge, read the same way the
 * curriculum screen reads them — `judgeLessons` and `resolveBridges` — so the button
 * the screen offers and the refusal behind it cannot disagree.
 */
@Injectable()
export class PrismaLessonLandingReader implements LessonLandingReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  find(userId: string, lessonId: string): Promise<LessonLanding | null> {
    return this.db.run(userId, async (tx) => {
      const [lesson] = await tx.$queryRawUnsafe<
        {
          id: string;
          mission_id: string;
          status: string;
          outcome: string | null;
          exercises: unknown;
        }[]
      >(
        `select id, mission_id, status, outcome, exercises from lessons where id = $1::uuid`,
        lessonId,
      );
      if (lesson === undefined) return null;

      const siblings = await tx.$queryRawUnsafe<
        {
          id: string;
          slug: string;
          seq: number | null;
          adjustment: string | null;
          bridge_for_slug: string | null;
        }[]
      >(
        `select id, slug, seq, adjustment, bridge_for_slug from lessons where mission_id = $1::uuid`,
        lesson.mission_id,
      );
      const bridges = resolveBridges(
        siblings.map((row) => ({
          id: row.id,
          slug: row.slug,
          seq: row.seq,
          adjustment:
            row.adjustment === "bridge" || row.adjustment === "harder"
              ? { kind: row.adjustment, bridgeForSlug: row.bridge_for_slug }
              : null,
        })),
      );

      return {
        missionId: lesson.mission_id,
        status: lesson.status === "planned" ? "planned" : "generated",
        strain: (await judgeLessons(tx, [lesson])).get(lesson.id)!,
        bridged: bridges.bridgeOf.has(lesson.id),
      };
    });
  }
}
