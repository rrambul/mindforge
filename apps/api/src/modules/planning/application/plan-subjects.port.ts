import type { PlanSubject } from "@mindforge/core";

export const PLAN_SUBJECTS = Symbol("PlanSubjects");

export interface PlanSubjectDetail {
  /** `missions.topic` or `skills.name`. Display text: the SPA renders it, and never translates it. */
  readonly label: string;
  /**
   * Missions only — a skill cannot be parked, so this is always false for one.
   *
   * Reported rather than filtered by the adapter, because §5.3's rule differs by direction: planning
   * against a parked mission is refused, while a mission parked *after* the plan was made is silently
   * excluded from plan-vs-actual. One reader, two callers, and the decision stays where it can be
   * read.
   */
  readonly parked: boolean;
}

/**
 * Who a mission or a skill is, for the module that plans time against them.
 *
 * The fourth copy of the existence-check idea after goals, resources and friction, and a copy for the
 * same reason they are: one module importing another's repository is the cross-module dependency the
 * layering exists to keep out, and twenty lines is cheaper than that coupling.
 *
 * It answers with **labels as well as existence** rather than leaving names to a second port. The
 * checks and the labels are the same join against the same two tables, and splitting them would mean
 * two round trips and two chances for the plan grid and the review screen to disagree about what a
 * mission is called.
 */
export interface PlanSubjectReader {
  /**
   * Batched, and keyed by `subjectKey`.
   *
   * A subject that is **absent from the result does not exist for this user**. Under RLS "there is no
   * such mission" and "that mission is someone else's" are the same answer, which is the one the
   * caller wants either way.
   */
  read(
    userId: string,
    subjects: readonly PlanSubject[],
  ): Promise<Readonly<Record<string, PlanSubjectDetail>>>;
}
