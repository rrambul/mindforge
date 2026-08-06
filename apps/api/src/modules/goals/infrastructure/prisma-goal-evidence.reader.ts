import {
  fadedScore,
  progressFraction,
  ResourceProgressSchema,
  type TargetEvidence,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import type { GoalEvidenceReader } from "../application/evidence.port.js";
import type { GoalTarget } from "../domain/goal-target.js";

/**
 * Reads what the §3.8 derivations need, for a batch of targets at once.
 *
 * Batched by kind rather than looped per target: the goals screen renders every goal with every
 * target, and one query per target turns a page load into twenty round trips.
 *
 * The kinds with no source yet are simply **absent from the result**, and that is the contract rather
 * than an oversight — `targetProgress` reads an absent field as "unknown" and reports the target as
 * unmeasurable, which is true. Returning `0` would render a full-width empty bar and claim the user
 * had made no progress on something the app cannot see.
 */
@Injectable()
export class PrismaGoalEvidenceReader implements GoalEvidenceReader {
  constructor(
    @Inject(USER_SCOPED_DB) private readonly db: UserScopedDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async read(
    userId: string,
    targets: readonly GoalTarget[],
  ): Promise<Readonly<Record<string, TargetEvidence>>> {
    if (targets.length === 0) return {};

    const resourceTargets = targets.filter((t) => t.kind === "resource_progress");
    const focusTargets = targets.filter((t) => t.kind === "focus_hours");
    const skillTargets = targets.filter((t) => t.kind === "skill_band");

    const [fractions, minutes, scores] = await this.db.run(userId, async (tx) => {
      const resourceIds = ids(resourceTargets);
      const missionIds = ids(focusTargets);
      const skillIds = ids(skillTargets);

      const resources =
        resourceIds.length === 0
          ? []
          : await tx.resource.findMany({
              where: { id: { in: resourceIds } },
              select: { id: true, progress: true },
            });

      // Raw SQL because a session has no `minutes` column — its duration is `ended_at - started_at`,
      // which Prisma cannot sum. `floor` per session rather than over the total, to match
      // `elapsedMinutes` in packages/core exactly: summing seconds and flooring once would drift by
      // up to a minute per session from the figure shown beside each session on the Today screen, and
      // two places disagreeing about the same hours is what non-negotiable 3 forbids.
      //
      // Only finished sessions. A running one has no duration yet, and counting its elapsed time
      // would make the goal advance on its own while the user sits still.
      const sessions =
        missionIds.length === 0
          ? []
          : await tx.$queryRawUnsafe<{ missionId: string; minutes: number }[]>(
              `select mission_id as "missionId",
                      coalesce(sum(floor(extract(epoch from (ended_at - started_at)) / 60)), 0)::float8
                        as minutes
                 from focus_sessions
                where mission_id = any($1::uuid[])
                  and ended_at is not null
                group by mission_id`,
              missionIds,
            );

      // `halfLifeDays` and `lastEvidenceAt` come too, because the figure a target compares against is
      // the *faded* score (FR-S4) — the same one the skills endpoint reports. Reading the raw column
      // here made a `skill_band` target hold as met while the skills screen showed the skill had faded
      // out of that band, which is the two-places-disagree failure non-negotiable 3 forbids, and it
      // silently disabled FR-M3b's whole point.
      const skills =
        skillIds.length === 0
          ? []
          : await tx.skill.findMany({
              where: { id: { in: skillIds } },
              select: {
                id: true,
                score: true,
                halfLifeDays: true,
                lastEvidenceAt: true,
              },
            });

      return [resources, sessions, skills] as const;
    });

    const fractionById = new Map(
      fractions.map((row) => [row.id, fractionOf(row.progress)] as const),
    );
    const minutesByMission = new Map(
      minutes.map((row) => [row.missionId, Math.max(0, Number(row.minutes))] as const),
    );
    const now = this.clock.now();
    const scoreById = new Map(
      scores.map(
        (row) =>
          [
            row.id,
            fadedScore(
              row.score === null ? null : Number(row.score),
              row.lastEvidenceAt,
              now,
              Number(row.halfLifeDays),
            ),
          ] as const,
      ),
    );

    const evidence: Record<string, TargetEvidence> = {};

    for (const target of resourceTargets) {
      const subject = target.subjectId;
      if (!subject) continue;
      // `has` rather than `get() ?? null`: a resource that was deleted is genuinely unknown, while one
      // whose length was never recorded has a null fraction. Both end up null here, but only the
      // second is a row we found — and conflating them would hide a dangling target.
      if (!fractionById.has(subject.id)) continue;
      evidence[target.id] = { resourceFraction: fractionById.get(subject.id) ?? null };
    }

    for (const target of focusTargets) {
      const subject = target.subjectId;
      if (!subject) continue;
      // Zero is real here, unlike a missing fraction: no sessions logged means no hours spent, which
      // is a fact rather than an absence.
      evidence[target.id] = { focusMinutes: minutesByMission.get(subject.id) ?? 0 };
    }

    for (const target of skillTargets) {
      const subject = target.subjectId;
      if (!subject || !scoreById.has(subject.id)) continue;
      // Null throughout M1 — scores come from assessments and reviews, which land in M2. Passed
      // through rather than defaulted, so the target reports unmeasurable rather than band `aware`.
      // Already faded above, so this is the same number the skills endpoint shows.
      evidence[target.id] = { skillScore: scoreById.get(subject.id) ?? null };
    }

    // `artifact`, `review_accuracy`, and `lessons_completed` are deliberately not here. See the class
    // note: absent means unknown, and unknown is the honest answer until those features exist.
    return evidence;
  }
}

function ids(targets: readonly GoalTarget[]): string[] {
  return [...new Set(targets.map((t) => t.subjectId?.id).filter((id): id is string => !!id))];
}

/** A resource's `progress` JSON to a fraction, using the same function the SPA uses. */
function fractionOf(progress: unknown): number | null {
  const parsed = ResourceProgressSchema.safeParse(progress);
  return parsed.success ? progressFraction(parsed.data) : null;
}
