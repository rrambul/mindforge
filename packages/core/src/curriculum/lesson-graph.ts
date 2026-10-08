/**
 * The lesson graph: what is fundamental, what is unblocked, what is next, and how
 * far through a module you are (FR-K6, FR-K7, FR-P2; TECH-DESIGN §3.2b).
 *
 * **Nothing here is ever stored.** `lesson_edges` records one fact — "A depends on
 * B" — and every derived reading of it is computed here, on read, by the API and
 * the SPA calling the same functions (non-negotiable 3). A stored `fundamental`
 * flag is a value that was true once; a stored progress fraction is a number that
 * was true before the plan was revised.
 *
 * The three rules that shape the code:
 *
 * 1. **Unknown is not zero.** A module with no lessons has no denominator, so
 *    `moduleProgress` returns null rather than `0/0` — the UI says "not planned
 *    yet" rather than drawing an empty bar, which would be a measurement claim
 *    about something unmeasured (non-negotiable 10).
 *
 * 2. **Fundamental is a count, not a badge.** A lesson is fundamental *because*
 *    other lessons depend on it, and the more that do the more fundamental it is.
 *    The count is returned rather than a boolean so the UI can rank by it (FR-K6).
 *
 * 3. **Dependencies come first, then difficulty.** Within a module a lesson is
 *    never listed before one it depends on; among the lessons that could come
 *    next, the easiest does, with the plan's own order as the tie-break. What may
 *    be *started* is still decided only by whether every prerequisite is finished
 *    (FR-K7).
 */

// Type-only, so the graph stays free of zod: it runs in the SPA bundle, and the
// outcome's *shape* is what the tally needs, not its validator.
import type { LessonOutcome } from "../schemas/lesson.js";

/** How far down a lesson goes. Stored as these keys; the UI translates them. */
export type LessonDepth = "overview" | "working" | "deep_dive";

/** A row `CURRICULUM.md` planned, or one `teach` wrote. */
export type LessonStatus = "planned" | "generated";

/**
 * One lesson, as much of it as any derivation here needs.
 *
 * Deliberately not the whole row: this runs in the SPA bundle as well as the API,
 * and a shape that named `storagePath` or `contentHash` would invite a caller to
 * pass a lesson's content through a maths function.
 */
export interface LessonNode {
  readonly id: string;
  /** Null for a lesson taught off-plan or written before the curriculum existed. */
  readonly trackId: string | null;
  readonly status: LessonStatus;
  /** 1–5 relative to this learner, or null when the plan did not say. */
  readonly difficulty: number | null;
  /** The plan's row order within its module, or null off-plan. */
  readonly position: number | null;
  /** From the filename, once the lesson has one. */
  readonly seq: number | null;
  readonly completed: boolean;
  readonly prerequisiteIds: readonly string[];
  /**
   * For a bridge, the lesson it is a smaller step toward (FR-D2). It is listed
   * right after that lesson, which is where it is taken: it has no row in the plan
   * and so no position of its own to sort by.
   */
  readonly bridgeForId?: string | null;
}

export interface DerivedLesson {
  readonly id: string;
  /** How many lessons name this one as a prerequisite (FR-K6). */
  readonly dependentCount: number;
  /** `dependentCount > 0`. Kept beside the count so the UI can badge and rank. */
  readonly fundamental: boolean;
  /** Every prerequisite completed (FR-K7). Says nothing about this lesson itself. */
  readonly unblocked: boolean;
  /** Prerequisites still to finish, so the UI can say *why* something is locked. */
  readonly blockedBy: readonly string[];
}

export interface ModuleProgress {
  readonly completed: number;
  readonly total: number;
}

/**
 * A mission's fraction, plus what it could not measure.
 *
 * `modulesNotPlanned` is part of the value rather than something the caller works
 * out, because a fraction over some of the modules must never be rendered as though
 * it were over all of them.
 */
export interface MissionProgress extends ModuleProgress {
  readonly modulesNotPlanned: number;
}

/**
 * How the finished lessons of a module landed (FR-P4).
 *
 * The four counts sum to the module's `completed`, and that is the property that
 * makes them honest: a distribution that quietly dropped the lessons finished
 * before an outcome could be recorded would show three understood out of five
 * completed and leave the reader to guess at the other two.
 */
export interface OutcomeCounts {
  readonly understood: number;
  readonly shaky: number;
  readonly lost: number;
  /** Completed with no outcome — an M4 row, or a completion made before M5. */
  readonly unrecorded: number;
}

/** As much of a lesson as the outcome tally needs. */
export interface LessonOutcomeNode {
  readonly completed: boolean;
  readonly outcome: LessonOutcome | null;
}

/**
 * Every lesson's derived state, keyed by id.
 *
 * A prerequisite id that names no lesson in the set does not block anything.
 * `lesson_edges` cascades on delete so the database cannot produce that state, but
 * a caller filtering to one module can — and a lesson locked behind a
 * prerequisite the caller chose not to load would be locked forever, with nothing
 * on screen to explain it.
 */
export function deriveLessons(lessons: readonly LessonNode[]): ReadonlyMap<string, DerivedLesson> {
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const dependents = new Map<string, number>();

  for (const lesson of lessons) {
    for (const prereqId of lesson.prerequisiteIds) {
      if (!byId.has(prereqId)) continue;
      dependents.set(prereqId, (dependents.get(prereqId) ?? 0) + 1);
    }
  }

  const derived = new Map<string, DerivedLesson>();

  for (const lesson of lessons) {
    const blockedBy = lesson.prerequisiteIds.filter((id) => byId.get(id)?.completed === false);
    const dependentCount = dependents.get(lesson.id) ?? 0;

    derived.set(lesson.id, {
      id: lesson.id,
      dependentCount,
      fundamental: dependentCount > 0,
      unblocked: blockedBy.length === 0,
      blockedBy,
    });
  }

  return derived;
}

/**
 * Order the lessons within one module: never a lesson before one it depends on,
 * and otherwise the easiest first, then the plan.
 *
 * Difficulty alone used to be the sort, so a difficulty-2 lesson that depends on a
 * difficulty-3 one was listed above it: "Thinking out loud" above the "complete
 * design" it waits on, in a module that read top to bottom as the wrong order.
 * Now each step takes the easiest lesson whose prerequisites *in this module* are
 * already placed. A prerequisite in another module is not this list's to order.
 *
 * A lesson with no difficulty sorts last rather than first. The alternative reads
 * an absent number as a 0, which would put every unrated lesson at the front of
 * the module and make "start with the easiest" mean "start with the ones nobody
 * graded".
 *
 * Ties fall through to the plan's row order, then to the file's sequence, then to
 * the id — so the order is total, and two renders of the same module never
 * disagree. A dependency cycle (the parser drops them, so this is a belt) cannot
 * stall it: when nothing is free, the easiest remaining lesson goes next.
 */
/**
 * How a module's lessons are ordered once dependencies are satisfied.
 *
 * `ease` — the easiest first, then the plan's row order (FR-K7): for a mission with
 * no calendar, where the learner chooses when to do what.
 * `plan` — the plan's row order, which for a mission planned in weeks **is** the
 * order of the days (FR-B3). The curriculum run is told to order the rows so day 1
 * to day 5 build on each other, and listing day 4 before day 3 because it is easier
 * shows the learner an order they will not take.
 *
 * Either way a bridge follows the lesson it bridges (FR-D2), since that is when it
 * is taken: the step it breaks out of that lesson comes before the lessons built
 * on it. Sorted by its missing position instead, it fell to the bottom of the
 * module, below days it was written to come before. Any other lesson with no row
 * comes after the planned ones.
 */
export type ModuleOrdering = "ease" | "plan";

export function orderModule(
  lessons: readonly LessonNode[],
  ordering: ModuleOrdering = "ease",
): readonly LessonNode[] {
  const inModule = new Set(lessons.map((lesson) => lesson.id));
  const waitingOn = new Map(
    lessons.map((lesson) => [
      lesson.id,
      new Set(lesson.prerequisiteIds.filter((id) => id !== lesson.id && inModule.has(id))),
    ]),
  );

  let remaining = [...lessons].sort(ordering === "plan" ? byPlan : byEase);
  const ordered: LessonNode[] = [];
  while (remaining.length > 0) {
    const next = remaining.find((lesson) => waitingOn.get(lesson.id)!.size === 0) ?? remaining[0]!;
    ordered.push(next);
    remaining = remaining.filter((lesson) => lesson !== next);
    for (const waiting of waitingOn.values()) waiting.delete(next.id);
  }
  return afterTheirTargets(ordered);
}

/**
 * Move each bridge to just after the lesson it bridges, behind any bridge already
 * there, so two steps toward one lesson keep the order they were written in.
 *
 * Not when that would put it before one of its own prerequisites: then it goes
 * last, after everything it could depend on. A bridge toward a lesson in another
 * module is left where the sort put it.
 */
function afterTheirTargets(ordered: readonly LessonNode[]): readonly LessonNode[] {
  const ids = new Set(ordered.map((lesson) => lesson.id));
  const bridges = ordered.filter(
    (lesson) => lesson.bridgeForId != null && ids.has(lesson.bridgeForId),
  );
  let result = ordered.filter((lesson) => !bridges.includes(lesson));

  for (const bridge of bridges) {
    let at = result.findIndex((lesson) => lesson.id === bridge.bridgeForId) + 1;
    while (at < result.length && result[at]!.bridgeForId === bridge.bridgeForId) at += 1;

    const before = new Set(result.slice(0, at).map((lesson) => lesson.id));
    const waits = bridge.prerequisiteIds.some((id) => ids.has(id) && !before.has(id));
    if (waits) at = result.length;
    result = [...result.slice(0, at), bridge, ...result.slice(at)];
  }
  return result;
}

function byEase(a: LessonNode, b: LessonNode): number {
  return (
    rank(a.difficulty) - rank(b.difficulty) ||
    rank(a.position) - rank(b.position) ||
    rank(a.seq) - rank(b.seq) ||
    // Ids are unique, so this last step only ever decides between two rows the
    // plan left genuinely indistinguishable — and it always decides the same way.
    a.id.localeCompare(b.id)
  );
}

function byPlan(a: LessonNode, b: LessonNode): number {
  return (
    rank(a.position) - rank(b.position) ||
    rank(a.difficulty) - rank(b.difficulty) ||
    rank(a.seq) - rank(b.seq) ||
    a.id.localeCompare(b.id)
  );
}

/** Null sorts last, whatever the column. */
function rank(value: number | null): number {
  return value === null ? Number.MAX_SAFE_INTEGER : value;
}

/**
 * How far through a module, as a fraction that means something (FR-P2).
 *
 * The denominator is every lesson the module has — the plan as it now stands,
 * plus anything taught off-plan — which is why it needs no "was this planned?"
 * flag to stay honest. **Null when the module has no lessons at all**: that is
 * "not planned yet", and there is no fraction to draw.
 */
export function moduleProgress(lessons: readonly LessonNode[]): ModuleProgress | null {
  if (lessons.length === 0) return null;

  return {
    completed: lessons.filter((lesson) => lesson.completed).length,
    total: lessons.length,
  };
}

/**
 * The status a module is shown with (FR-K5).
 *
 * Every module starts `proposed`, the plan's word, and nothing the learner does
 * rewrites the file. So a module with a finished lesson read "Proposed" under
 * "2 of 6 lessons done". Started is a fact about the lessons, derived here rather
 * than stored, and it opens the module; every other status is the plan's to say.
 */
export function moduleStatus(stored: string, progress: ModuleProgress | null): string {
  return stored === "proposed" && progress !== null && progress.completed > 0 ? "active" : stored;
}

/**
 * How far through the whole mission, from its modules' fractions (FR-P3).
 *
 * **The denominator is only what has been planned.** A module with no lessons
 * contributes nothing to either side rather than contributing a zero, for the same
 * reason `moduleProgress` returns null for it: a mission whose later half has not
 * been planned yet is not a mission you are behind on, and adding those modules to
 * the total as zeroes would draw a bar that falls every time the curriculum grows a
 * subtopic.
 *
 * That makes the fraction honest but partial, so `modulesNotPlanned` comes back with
 * it — a bar over eight of fourteen modules has to be able to say so, or it is a
 * claim about the whole mission that was measured on part of one.
 *
 * **Null when nothing at all is planned**, which is a fresh mission before its first
 * curriculum run. There is no fraction to draw and "0%" would be a measurement of
 * something that does not exist yet (non-negotiable 10).
 */
export function missionProgress(
  modules: readonly (ModuleProgress | null)[],
): MissionProgress | null {
  const planned = modules.filter((module) => module !== null);
  if (planned.length === 0) return null;

  return {
    completed: planned.reduce((sum, module) => sum + module.completed, 0),
    total: planned.reduce((sum, module) => sum + module.total, 0),
    modulesNotPlanned: modules.length - planned.length,
  };
}

/**
 * The outcome distribution of a module's finished lessons (FR-P4).
 *
 * **Null when the module has no lessons at all**, for the same reason
 * `moduleProgress` returns null: there is nothing to distribute, and four zeros
 * would read as "you got none of them" rather than "there is nothing here yet".
 * A module that *has* lessons and has finished none is a different thing — those
 * zeros are measured, and they are returned.
 *
 * A `shaky` lesson is counted as completed and stays visibly shaky; nothing here
 * blends it towards `understood`, and nothing decays it with time
 * (non-negotiable 10).
 */
export function moduleOutcomes(lessons: readonly LessonOutcomeNode[]): OutcomeCounts | null {
  if (lessons.length === 0) return null;

  const counts = { understood: 0, shaky: 0, lost: 0, unrecorded: 0 };

  for (const lesson of lessons) {
    if (!lesson.completed) continue;
    if (lesson.outcome === null) counts.unrecorded += 1;
    else counts[lesson.outcome] += 1;
  }

  return counts;
}

/**
 * The next thing to do: the first unblocked, unfinished lesson (FR-K7).
 *
 * Modules are taken in the order given — the caller owns that, because it comes
 * from `track_edges` and `tracks.position` and not from anything here — and within
 * a module `orderModule` decides, by ease or, for a mission planned in weeks, by
 * the plan's days.
 *
 * A lesson that is already written but unread is a candidate, and it comes before
 * any planned lesson its module puts after it. Generating a new lesson while an
 * unread one waits is how a curriculum turns into a backlog, and the returned
 * node's `status` is what lets the caller say "read this" rather than "teach this".
 *
 * Lessons in no module are never suggested: "module order" has nothing to say
 * about them, and an off-plan lesson was a deliberate detour rather than the plan
 * asking for something.
 */
export function nextLesson(
  lessons: readonly LessonNode[],
  moduleOrder: readonly string[],
  ordering: ModuleOrdering = "ease",
): LessonNode | null {
  const derived = deriveLessons(lessons);

  for (const trackId of moduleOrder) {
    const module = orderModule(
      lessons.filter((lesson) => lesson.trackId === trackId),
      ordering,
    );

    const candidate = module.find(
      (lesson) => !lesson.completed && derived.get(lesson.id)!.unblocked,
    );
    if (candidate) return candidate;
  }

  return null;
}
