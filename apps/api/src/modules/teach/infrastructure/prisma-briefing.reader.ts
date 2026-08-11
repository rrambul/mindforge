import {
  deriveLessons,
  nextLesson,
  orderModule,
  type LessonDepth,
  type LessonNode,
} from "@mindforge/core";
import {
  NO_TRACK,
  type BriefingFacts,
  type CurrentTrack,
  type PlannedLesson,
  type Tracked,
} from "@mindforge/workspace";
import { Inject, Injectable } from "@nestjs/common";

import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import type { BriefingReader } from "../application/briefing.port.js";

/**
 * What Mindforge actually knows about a mission, for the briefing.
 *
 * Every section here is queried, and that is new: until M5 lesson outcomes had no
 * source at all, so the reader deliberately did not query them and handed over a
 * sentence saying why — an empty list would have rendered as a measurement of a
 * learner who had completed nothing. The in-app reader ships in M5, so the signal
 * exists and an empty result now means what it says (§7.3b).
 */

/** The `## Next` sections the what-next section reads, newest first. */
const ZPD_LIMIT = 8;

/**
 * How many finished lessons the briefing names, newest first.
 *
 * Bounded because the briefing is read by a model with a context window and a
 * mission can accumulate sixty of them; newest first because what the learner did
 * last week is what a run should be reacting to. The count of everything is
 * already in the header, so nothing is hidden by the cut.
 */
const OUTCOME_LIMIT = 12;

@Injectable()
export class PrismaBriefingReader implements BriefingReader {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  gather(userId: string, missionId: string): Promise<BriefingFacts> {
    return this.db.run(userId, async (tx) => {
      const [mission] = await tx.$queryRawUnsafe<{ topic: string }[]>(
        `select topic from missions where id = $1::uuid`,
        missionId,
      );

      const [counts] = await tx.$queryRawUnsafe<{ lessons: bigint; records: bigint }[]>(
        `select
           (select count(*) from lessons where mission_id = $1::uuid) as lessons,
           (select count(*) from learning_records where mission_id = $1::uuid) as records`,
        missionId,
      );

      const outcomes = await tx.$queryRawUnsafe<
        { seq: number | null; title: string; outcome: string | null }[]
      >(
        `select seq, title, outcome from lessons
          where mission_id = $1::uuid and completed_at is not null
          order by completed_at desc
          limit $2`,
        missionId,
        OUTCOME_LIMIT,
      );

      const records = await tx.$queryRawUnsafe<{ next: string; storage_path: string }[]>(
        `select next, storage_path from learning_records
          where mission_id = $1::uuid and next is not null and next <> ''
          order by recorded_at desc
          limit $2`,
        missionId,
        ZPD_LIMIT,
      );

      return {
        missionTopic: mission?.topic ?? null,
        lessonCount: Number(counts?.lessons ?? 0),
        recordCount: Number(counts?.records ?? 0),
        currentTrack: await readCurrentTrack(tx, missionId),
        zpdCandidates: records.map((record) => ({
          next: record.next,
          fromRecord: record.storage_path.split("/").pop() ?? record.storage_path,
        })),
        lessonOutcomes: outcomes.map(describeOutcome),
      } satisfies BriefingFacts;
    });
  }
}

/**
 * One finished lesson, as a line the agent reads.
 *
 * A completion with no outcome says so rather than being dropped or guessed at:
 * M4 rows exist that were finished before the reader could ask how it went, and
 * "finished, outcome not recorded" is the true statement about them.
 */
function describeOutcome(row: {
  seq: number | null;
  title: string;
  outcome: string | null;
}): string {
  const number = row.seq === null ? "" : `${String(row.seq).padStart(4, "0")} `;
  const outcome = row.outcome ?? "finished, outcome not recorded";
  return `${number}${row.title} — ${outcome}`;
}

/** The transaction handle `UserScopedDb.run` hands its callback. */
type Tx = { $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> };

/**
 * The open module, or the reason there isn't one.
 *
 * The two null cases are told apart deliberately. "No curriculum" and "a
 * curriculum with nothing open" call for different behaviour from the agent —
 * teach from the mission in both, but only in the second is leaving the meta tag
 * off a decision rather than the only option — and collapsing them into one
 * `null` would leave the briefing unable to say which.
 */
async function readCurrentTrack(tx: Tx, missionId: string): Promise<Tracked<CurrentTrack>> {
  const [total] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    // `dropped` tracks are excluded from the denominator: they are retained so a
    // module of finished lessons survives a regenerated curriculum, not because
    // they are still part of the plan.
    `select count(*) as n from tracks where mission_id = $1::uuid and status <> 'dropped'`,
    missionId,
  );

  const totalTracks = Number(total?.n ?? 0);
  if (totalTracks === 0) return NO_TRACK.noCurriculum;

  const [track] = await tx.$queryRawUnsafe<
    { id: string; slug: string; name: string; outcome: string | null; position: number }[]
  >(
    // One row at most: `tracks_one_active_per_mission_key` is a partial unique index.
    `select id, slug, name, outcome, position from tracks
      where mission_id = $1::uuid and status = 'active'`,
    missionId,
  );

  if (!track) return NO_TRACK.noneOpen;

  const [prerequisites, lessons] = await Promise.all([
    tx.$queryRawUnsafe<{ name: string }[]>(
      `select p.name from track_edges e
         join tracks p on p.id = e.prereq_id
        where e.track_id = $1::uuid
        order by p.position`,
      track.id,
    ),
    tx.$queryRawUnsafe<{ seq: number; title: string }[]>(
      // Written lessons only. A planned row has no `seq` and nothing to read, and
      // listing it here as one the agent must not repeat would be a claim that a
      // lesson exists when the module is precisely still owed it.
      `select seq, title from lessons
        where track_id = $1::uuid and status = 'generated'
        order by seq`,
      track.id,
    ),
  ]);

  const plan = await readPlan(tx, missionId, track.id);

  return {
    slug: track.slug,
    name: track.name,
    outcome: track.outcome,
    position: track.position,
    totalTracks,
    prerequisites: prerequisites.map((row) => row.name),
    lessons: lessons.map((row) => ({ seq: row.seq, title: row.title })),
    plan: plan.plan,
    nextLesson: plan.nextLesson,
  };
}

interface LessonRow {
  readonly id: string;
  readonly track_id: string | null;
  readonly slug: string;
  readonly title: string;
  readonly intent: string | null;
  readonly status: string;
  readonly difficulty: number | null;
  readonly depth: LessonDepth | null;
  readonly position: number | null;
  readonly seq: number | null;
  readonly completed_at: Date | null;
}

/**
 * The open module's plan, ordered and gated by `packages/core`.
 *
 * **The whole mission is loaded, not just this module.** A lesson may depend on
 * one in an earlier module (FR-K2), so a query scoped to the open track would
 * find no prerequisite rows and call every lesson unblocked — which is the exact
 * shape of a wrong answer that looks right: the plan would still be in a sensible
 * order, and the agent would be told to write something the learner cannot follow.
 */
async function readPlan(
  tx: Tx,
  missionId: string,
  trackId: string,
): Promise<{ plan: readonly PlannedLesson[]; nextLesson: PlannedLesson | null }> {
  const [rows, edges] = await Promise.all([
    tx.$queryRawUnsafe<LessonRow[]>(
      `select id, track_id, slug, title, intent, status, difficulty, depth, position, seq,
              completed_at
         from lessons where mission_id = $1::uuid`,
      missionId,
    ),
    tx.$queryRawUnsafe<{ lesson_id: string; prereq_id: string }[]>(
      `select e.lesson_id, e.prereq_id from lesson_edges e
         join lessons l on l.id = e.lesson_id
        where l.mission_id = $1::uuid`,
      missionId,
    ),
  ]);

  const prerequisites = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = prerequisites.get(edge.lesson_id);
    if (existing) existing.push(edge.prereq_id);
    else prerequisites.set(edge.lesson_id, [edge.prereq_id]);
  }

  const nodes: LessonNode[] = rows.map((row) => ({
    id: row.id,
    trackId: row.track_id,
    status: row.status === "planned" ? "planned" : "generated",
    difficulty: row.difficulty,
    position: row.position,
    seq: row.seq,
    completed: row.completed_at !== null,
    prerequisiteIds: prerequisites.get(row.id) ?? [],
  }));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const derived = deriveLessons(nodes);

  const brief = (node: LessonNode): PlannedLesson => {
    const row = byId.get(node.id)!;
    return {
      slug: row.slug,
      title: row.title,
      intent: row.intent,
      difficulty: row.difficulty,
      depth: row.depth,
      written: node.status === "generated",
      unblocked: derived.get(node.id)!.unblocked,
      blockedBy: derived
        .get(node.id)!
        .blockedBy.map((id) => byId.get(id)?.title)
        .filter((title): title is string => title !== undefined),
    };
  };

  const module = orderModule(nodes.filter((node) => node.trackId === trackId));
  const next = nextLesson(nodes, [trackId]);

  return {
    plan: module.map(brief),
    // A lesson that is already written is never the one to write. `nextLesson`
    // returns it so the app can say "read this" (M5); here, where the only verb
    // is "teach", it is not an instruction.
    nextLesson: next === null || next.status === "generated" ? null : brief(next),
  };
}
