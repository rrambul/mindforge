/**
 * Plan versus actual — "the core weekly insight" (FR-F5).
 *
 * The arithmetic is trivial and the honesty is not, so most of what follows is about which numbers
 * are allowed to exist:
 *
 * - **A planned subject with no minutes reads zero, and that is a measurement.** You said four hours
 *   of Rust and did none. Null would be a dodge.
 * - **An unplanned subject has no attainment at all.** Two hours against a plan of nothing is not
 *   200%, not infinite, and not "over target" — it is work you did without planning it, which the
 *   review is supposed to show you rather than score.
 * - **Nothing here is a grade.** There is no "on track" flag and no colour, because a week where you
 *   planned wrong and worked well looks identical to one where you planned right and slacked, and
 *   only you can tell which. §7.2: honesty over encouragement.
 *
 * Parked missions are excluded from both sides by the caller, not here (§5.3): parking is a
 * statement about intent, and this module only knows minutes.
 */

/** A mission or a skill. Ids only — labels are display, and this package cannot look them up. */
export interface PlanSubject {
  readonly kind: "mission" | "skill";
  readonly id: string;
}

export interface Allocation {
  readonly subject: PlanSubject;
  readonly plannedMinutes: number;
}

export interface ActualMinutes {
  readonly subject: PlanSubject;
  readonly minutes: number;
}

export interface PlanRow {
  readonly subject: PlanSubject;
  /** Null when nothing was planned for this subject — see the note about 200% above. */
  readonly plannedMinutes: number | null;
  readonly actualMinutes: number;
  /** actual − planned. Null when there was no plan to be over or under. */
  readonly deltaMinutes: number | null;
  /** actual ÷ planned, unclamped. Null when unplanned. */
  readonly attainment: number | null;
}

export interface PlanVsActual {
  /** Planned subjects first, by descending target; then unplanned work, by descending minutes. */
  readonly rows: readonly PlanRow[];
  readonly plannedTotal: number;
  readonly actualTotal: number;
  /** Of `actualTotal`, how much went to subjects the week never named. */
  readonly unplannedMinutes: number;
  /**
   * actualTotal ÷ plannedTotal, or null when the week had no plan.
   *
   * Deliberately whole-week rather than an average of the per-row attainments: doing 200% of a
   * 15-minute target and 10% of a six-hour one is not a 105% week.
   */
  readonly attainment: number | null;
}

function key(subject: PlanSubject): string {
  return `${subject.kind}:${subject.id}`;
}

export function planVsActual(
  allocations: Iterable<Allocation>,
  actuals: Iterable<ActualMinutes>,
): PlanVsActual {
  const planned = new Map<string, Allocation>();
  for (const allocation of allocations) {
    if (allocation.plannedMinutes < 0) {
      throw new RangeError(`plannedMinutes must be >= 0, received ${allocation.plannedMinutes}`);
    }
    // Last write wins on a duplicate. The database's partial unique indexes make this unreachable
    // through the API, but the rollup and the seed both build this map by hand.
    planned.set(key(allocation.subject), allocation);
  }

  const actual = new Map<string, number>();
  for (const entry of actuals) {
    if (entry.minutes < 0) {
      throw new RangeError(`actual minutes must be >= 0, received ${entry.minutes}`);
    }
    actual.set(key(entry.subject), (actual.get(key(entry.subject)) ?? 0) + entry.minutes);
  }

  const plannedRows: PlanRow[] = [];
  for (const [id, allocation] of planned) {
    const actualMinutes = actual.get(id) ?? 0;
    plannedRows.push({
      subject: allocation.subject,
      plannedMinutes: allocation.plannedMinutes,
      actualMinutes,
      deltaMinutes: actualMinutes - allocation.plannedMinutes,
      attainment:
        allocation.plannedMinutes === 0 ? null : actualMinutes / allocation.plannedMinutes,
    });
  }

  const unplannedRows: PlanRow[] = [];
  for (const entry of actual) {
    if (planned.has(entry[0])) continue;
    const [kind, id] = splitKey(entry[0]);
    unplannedRows.push({
      subject: { kind, id },
      plannedMinutes: null,
      actualMinutes: entry[1],
      deltaMinutes: null,
      attainment: null,
    });
  }

  // Sorted here rather than in SQL: the subject is a text discriminator plus a uuid, and ordering
  // an enum-ish text column alphabetically has already bitten this codebase twice.
  plannedRows.sort(
    (a, b) => b.plannedMinutes! - a.plannedMinutes! || compareSubject(a.subject, b.subject),
  );
  unplannedRows.sort(
    (a, b) => b.actualMinutes - a.actualMinutes || compareSubject(a.subject, b.subject),
  );

  const plannedTotal = plannedRows.reduce((sum, row) => sum + row.plannedMinutes!, 0);
  const actualTotal = [...actual.values()].reduce((sum, minutes) => sum + minutes, 0);
  const unplannedMinutes = unplannedRows.reduce((sum, row) => sum + row.actualMinutes, 0);

  return {
    rows: [...plannedRows, ...unplannedRows],
    plannedTotal,
    actualTotal,
    unplannedMinutes,
    attainment: plannedTotal === 0 ? null : actualTotal / plannedTotal,
  };
}

function splitKey(composite: string): [PlanSubject["kind"], string] {
  const separator = composite.indexOf(":");
  return [composite.slice(0, separator) as PlanSubject["kind"], composite.slice(separator + 1)];
}

/** Stable tiebreak, so the same week never renders in two different orders. */
function compareSubject(a: PlanSubject, b: PlanSubject): number {
  return a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind);
}
