import {
  addDays,
  currentDeadline,
  currentModule,
  dayBounds,
  deadlineStatus,
  deriveLessons,
  examResult,
  localDay,
  missionProgress,
  moduleFinishedAt,
  moduleOutcomes,
  moduleProgress,
  nextAdjustment,
  nextLesson,
  orderModule,
  PACE_WINDOW_DAYS,
  projectSchedule,
  resolveBridges,
  schedulePace,
  type Bridges,
  type CurriculumLesson,
  type CurriculumModule,
  type CurriculumView,
  type ExamResultView,
  type IsoDate,
  type LessonNode,
  type ModuleDeadlineView,
  type ModuleWork,
  type PaceResult,
  type PaceView,
  type Projection,
  type UpcomingAdjustment,
} from "@mindforge/core";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import {
  CURRICULUM_READER,
  type CurriculumReader,
  type ExamRow,
  type LessonRow,
  type TrackRow,
} from "./curriculum.port.js";

/**
 * The curriculum screen's read side (FR-K5).
 *
 * No `domain/` layer, for the reason the insights module gives: nothing here
 * writes, and the maths that would be domain logic already lives in
 * `packages/core` — the SPA renders the same locked states and the same fractions,
 * and non-negotiable 3 forbids a second implementation. This use case is the
 * join between the rows and those functions, and nothing else.
 *
 * **Everything derived is derived here, on read.** Nothing on the wire is stored:
 * `fundamental` is a count over `lesson_edges`, `unblocked` is every prerequisite
 * completed, and `progress` is counted at the moment you ask.
 */

/**
 * The wire shapes, derived from `packages/core`'s schemas rather than declared
 * here.
 *
 * They were declared here *and* in the SPA's `use-curriculum.ts`, linked by the
 * comment "Mirrors `LessonView`". Renaming a field on this side left every check
 * green and broke the screen at runtime, which is the whole reason the contract
 * moved. `CurriculumViewSchema` is what both ends now read.
 */
export type { CurriculumView, CurriculumLesson as LessonView, CurriculumModule as ModuleView };

@Injectable()
export class GetCurriculum {
  constructor(
    @Inject(CURRICULUM_READER) private readonly curriculum: CurriculumReader,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `timezone` is the learner's: "today", the pace window and every date on the
   * schedule are their local days (FR-U6), never the server's.
   */
  async execute(userId: string, missionId: string, timezone: string): Promise<CurriculumView> {
    const today = localDay(this.clock.now(), timezone);
    const paceSince = dayBounds(addDays(today, -(PACE_WINDOW_DAYS - 1)), timezone).start;

    const rows = await this.curriculum.read(userId, missionId, paceSince);
    if (rows === null) throw new NotFoundException("mission_not_found");

    const nodes = rows.lessons.map(toNode);
    const derived = deriveLessons(nodes);
    const titles = new Map(rows.lessons.map((lesson) => [lesson.id, lesson.title]));
    const byId = new Map(rows.lessons.map((lesson) => [lesson.id, lesson]));
    const bridges = resolveBridges(
      rows.lessons.map((lesson) => ({
        id: lesson.id,
        slug: lesson.slug,
        seq: lesson.seq,
        adjustment: lesson.adjustment,
      })),
    );
    const linked = (id: string | undefined) =>
      id === undefined ? null : { id, title: titles.get(id) ?? "" };

    const shown = rows.tracks.filter((track) => isShown(track, rows.lessons));
    const order = shown.map((track) => track.id);

    const slugs = new Map(rows.lessons.map((lesson) => [lesson.slug, lesson]));
    const exams = new Map(shown.map((track) => [track.id, examOf(track.id, rows.exams)]));

    const modules = shown.map((track): Omit<CurriculumModule, "deadline" | "projection"> => {
      const inModule = nodes.filter((node) => node.trackId === track.id);
      const exam = exams.get(track.id) ?? null;
      const result = exam === null ? null : examResult(exam.items);
      const finishedAt = moduleFinishedAt(
        inModule.map((node) => byId.get(node.id)!.completedAt),
        result?.passed === true ? result.passedAt : null,
      );

      return {
        id: track.id,
        slug: track.slug,
        name: track.name,
        outcome: track.outcome,
        status: track.status,
        prerequisites: track.prerequisites,
        progress: moduleProgress(inModule),
        outcomes: moduleOutcomes(
          inModule.map((node) => ({
            completed: node.completed,
            outcome: byId.get(node.id)!.outcome,
          })),
        ),
        lessons: orderModule(inModule).map((node) => {
          const row = byId.get(node.id)!;
          const state = derived.get(node.id)!;

          return {
            id: row.id,
            slug: row.slug,
            title: row.title,
            intent: row.intent,
            status: row.status,
            difficulty: row.difficulty,
            depth: row.depth,
            completed: node.completed,
            outcome: row.outcome,
            unblocked: state.unblocked,
            // Titles rather than ids: the lock is rendered as a sentence, and an
            // id in it would be a reason nobody can read.
            blockedBy: state.blockedBy.map((id) => titles.get(id)).filter(isString),
            dependentCount: state.dependentCount,
            strain: row.strain,
            adjustment:
              row.adjustment === null
                ? null
                : {
                    kind: row.adjustment.kind,
                    reason: row.adjustment.reason,
                    bridgeFor: linked(bridges.target.get(row.id)),
                  },
            bridge: linked(bridges.bridgeOf.get(row.id)),
          };
        }),
        exam:
          exam === null
            ? null
            : { lessonId: exam.id, title: exam.title, result: toResultView(result, slugs) },
        finishedAt: finishedAt?.toISOString() ?? null,
      };
    });

    // The module the learner is in (FR-U5), decided before the schedule because the
    // schedule starts with it.
    const next = nextLesson(nodes, order);
    const current = currentModule(
      modules
        .filter((module) => module.status !== "dropped")
        .map((module) => ({
          id: module.id,
          lessonsDone:
            module.progress !== null && module.progress.completed === module.progress.total,
          hasExam: module.exam !== null,
          finished: module.finishedAt !== null,
        })),
      next?.trackId ?? null,
    );

    // The schedule (FR-U4): every shown module, **starting with the one you are in**,
    // then the rest in curriculum order. Queued behind an earlier module with work
    // left, the module you are in would be proposed one date and judged against a
    // later one — "behind" the moment you accepted the date the screen offered. A
    // dropped module is still listed (it may hold finished lessons) and takes no time.
    const pace = schedulePace(rows.pace);
    const work = modules.map((module): ModuleWork => ({
      id: module.id,
      dropped: module.status === "dropped",
      planned: module.progress !== null,
      remainingLessons:
        module.progress === null ? 0 : module.progress.total - module.progress.completed,
      examPassed: module.exam?.result?.passed === true,
    }));
    const schedule = projectSchedule(
      [
        ...work.filter((module) => module.id === current),
        ...work.filter((module) => module.id !== current),
      ],
      pace,
      today,
    );

    const withSchedule = modules.map((module): CurriculumModule => {
      const projection = schedule.get(module.id)!;
      return {
        ...module,
        projection,
        deadline: deadlineView(rows.deadlines.get(module.id) ?? [], {
          today,
          finishedOn:
            module.finishedAt === null ? null : localDay(new Date(module.finishedAt), timezone),
          projectedOn: projection.status === "projected" ? projection.examDay : null,
        }),
      };
    });

    return {
      missionId,
      modules: withSchedule,
      // Over the modules the screen shows, so the bar and the panels under it are
      // counting the same lessons. A fraction that silently included a dropped
      // module would not add up to anything on the page.
      progress: missionProgress(modules.map((module) => module.progress)),
      // Over every lesson, not only the shown modules': a lesson can be locked by
      // one in a module this screen hides, and the answer must not change because
      // of what is on screen.
      nextLessonId: next?.id ?? null,
      upcoming: upcoming(rows.lessons, bridges),
      today,
      pace: paceView(pace),
      currentModuleId: current,
      // Only for the module the learner is in, and only while it has no deadline
      // (FR-U5). Its own projection, which the schedule starts with: the date proposed
      // is the date the deadline is then judged against.
      proposal:
        current === null || rows.deadlines.has(current)
          ? null
          : { moduleId: current, dueOn: proposedDay(schedule.get(current)!) },
    };
  }
}

/**
 * A module's exam: the newest exam file filed under it (FR-E1). An older one stays a
 * row — it is the learner's file, and its attempts are theirs — but it is not the
 * module's exam any more.
 */
function examOf(trackId: string, exams: readonly ExamRow[]): ExamRow | null {
  return exams.filter((exam) => exam.trackId === trackId).sort((a, b) => b.seq - a.seq)[0] ?? null;
}

function toResultView(
  result: ReturnType<typeof examResult>,
  lessons: ReadonlyMap<string, LessonRow>,
): ExamResultView | null {
  if (result === null) return null;
  return {
    total: result.total,
    passedCount: result.passedCount,
    checkedPasses: result.checkedPasses,
    selfReportedPasses: result.selfReportedPasses,
    attempted: result.attempted,
    passed: result.passed,
    passedAt: result.passedAt?.toISOString() ?? null,
    // A slug that names no lesson in this mission is dropped rather than shown as a
    // dead link: the item said what it covered, and the mission has no such lesson.
    revisit: result.revisit.flatMap((slug) => {
      const lesson = lessons.get(slug);
      return lesson === undefined ? [] : [{ id: lesson.id, title: lesson.title }];
    }),
  };
}

function deadlineView(
  history: Parameters<typeof currentDeadline>[0],
  facts: { today: IsoDate; finishedOn: IsoDate | null; projectedOn: IsoDate | null },
): ModuleDeadlineView | null {
  const deadline = currentDeadline(history);
  if (deadline === null) return null;
  return {
    dueOn: deadline.dueOn,
    firstDueOn: deadline.firstDueOn,
    moves: deadline.moves,
    status: deadlineStatus({ dueOn: deadline.dueOn, ...facts }),
  };
}

function paceView(pace: PaceResult): PaceView {
  return pace.status === "known"
    ? { status: "known", ...pace.pace }
    : { status: "unknown", missing: pace.missing, timedLessons: pace.timedLessons };
}

function proposedDay(projection: Projection): IsoDate | null {
  return projection.status === "projected" ? projection.examDay : null;
}

/**
 * What the next lesson will do about how the last ones landed (FR-D2, FR-D3).
 *
 * The same `nextAdjustment` the briefing tells the run, over finished lessons
 * newest first — so the screen announces exactly what the agent is being asked to
 * do, and the two cannot disagree.
 */
function upcoming(lessons: readonly LessonRow[], bridges: Bridges): UpcomingAdjustment | null {
  const finished = lessons
    .filter((lesson) => lesson.completedAt !== null)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());

  const adjustment = nextAdjustment(
    finished.map((lesson) => ({
      lessonId: lesson.id,
      slug: lesson.slug,
      title: lesson.title,
      strain: lesson.strain,
      bridged: bridges.bridgeOf.has(lesson.id),
    })),
  );

  if (adjustment === null) return null;
  if (adjustment.kind === "bridge") {
    return { kind: "bridge", lessonId: adjustment.lesson.lessonId, title: adjustment.lesson.title };
  }
  if (adjustment.kind === "harder") {
    return {
      kind: "harder",
      lessons: adjustment.because.map((lesson) => ({ id: lesson.lessonId, title: lesson.title })),
    };
  }
  return { kind: "as-planned" };
}

function toNode(lesson: LessonRow): LessonNode {
  return {
    id: lesson.id,
    trackId: lesson.trackId,
    status: lesson.status,
    difficulty: lesson.difficulty,
    position: lesson.position,
    seq: lesson.seq,
    completed: lesson.completedAt !== null,
    prerequisiteIds: lesson.prerequisiteIds,
  };
}

/**
 * Which modules the screen shows.
 *
 * A dropped module is one a regenerated `CURRICULUM.md` stopped mentioning. It is
 * retained rather than deleted because it may hold finished lessons — so it is
 * shown when it does, and hidden when it is an empty row the plan has moved past.
 * Hiding it either way would make a learner's own finished work disappear from the
 * only screen that lists it.
 */
function isShown(track: TrackRow, lessons: readonly LessonRow[]): boolean {
  if (track.status !== "dropped") return true;
  return lessons.some((lesson) => lesson.trackId === track.id && lesson.status === "generated");
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
