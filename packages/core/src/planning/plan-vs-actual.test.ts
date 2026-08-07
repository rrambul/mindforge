import { describe, expect, it } from "vitest";
import { planVsActual, type PlanSubject } from "./plan-vs-actual.js";

const rust: PlanSubject = { kind: "mission", id: "aaaaaaaa-0000-4000-8000-000000000001" };
const react: PlanSubject = { kind: "mission", id: "aaaaaaaa-0000-4000-8000-000000000002" };
const ownership: PlanSubject = { kind: "skill", id: "bbbbbbbb-0000-4000-8000-000000000001" };

describe("planVsActual", () => {
  it("is empty and unscored for a week with no plan and no work", () => {
    expect(planVsActual([], [])).toEqual({
      rows: [],
      plannedTotal: 0,
      actualTotal: 0,
      unplannedMinutes: 0,
      attainment: null,
    });
  });

  it("reports zero against a plan you did nothing about", () => {
    // Zero here is a measurement, not missing data: you said four hours and did none. The null
    // convention elsewhere in this package would be a dodge.
    const result = planVsActual([{ subject: rust, plannedMinutes: 240 }], []);
    expect(result.rows).toEqual([
      {
        subject: rust,
        plannedMinutes: 240,
        actualMinutes: 0,
        deltaMinutes: -240,
        attainment: 0,
      },
    ]);
    expect(result.attainment).toBe(0);
  });

  it("gives unplanned work no attainment at all", () => {
    // Two hours against a plan of nothing is not 200%, not infinite, and not "over target".
    const result = planVsActual([], [{ subject: react, minutes: 120 }]);
    expect(result.rows).toEqual([
      {
        subject: react,
        plannedMinutes: null,
        actualMinutes: 120,
        deltaMinutes: null,
        attainment: null,
      },
    ]);
    expect(result.unplannedMinutes).toBe(120);
    expect(result.attainment).toBeNull();
  });

  it("gives a zero-minute allocation no attainment either", () => {
    // The database forbids these, but the seed and the rollup build allocations by hand, and a
    // division by zero would surface as Infinity in a progress bar.
    const result = planVsActual(
      [{ subject: rust, plannedMinutes: 0 }],
      [{ subject: rust, minutes: 30 }],
    );
    expect(result.rows[0]!.attainment).toBeNull();
    expect(result.rows[0]!.deltaMinutes).toBe(30);
  });

  it("matches actuals to allocations across both subject kinds", () => {
    const result = planVsActual(
      [
        { subject: rust, plannedMinutes: 240 },
        { subject: ownership, plannedMinutes: 60 },
      ],
      [
        { subject: rust, minutes: 180 },
        { subject: ownership, minutes: 90 },
      ],
    );
    expect(result.rows.map((r) => [r.subject.kind, r.plannedMinutes, r.actualMinutes])).toEqual([
      ["mission", 240, 180],
      ["skill", 60, 90],
    ]);
    expect(result.attainment).toBe(270 / 300);
  });

  it("does not confuse a mission and a skill that share an id", () => {
    // Both are uuids from different tables, so a collision is possible in a seed or a fixture and
    // would silently merge two rows.
    const shared = "cccccccc-0000-4000-8000-000000000001";
    const result = planVsActual(
      [{ subject: { kind: "mission", id: shared }, plannedMinutes: 60 }],
      [{ subject: { kind: "skill", id: shared }, minutes: 30 }],
    );
    expect(result.rows).toHaveLength(2);
    expect(result.plannedTotal).toBe(60);
    expect(result.unplannedMinutes).toBe(30);
  });

  it("sums repeated actuals for one subject", () => {
    // Actuals arrive as one row per session, not pre-aggregated.
    const result = planVsActual(
      [{ subject: rust, plannedMinutes: 120 }],
      [
        { subject: rust, minutes: 25 },
        { subject: rust, minutes: 50 },
      ],
    );
    expect(result.rows[0]!.actualMinutes).toBe(75);
  });

  it("orders planned work by target and unplanned work after it, by minutes", () => {
    const result = planVsActual(
      [
        { subject: ownership, plannedMinutes: 60 },
        { subject: rust, plannedMinutes: 240 },
      ],
      [
        { subject: react, minutes: 45 },
        { subject: rust, minutes: 10 },
      ],
    );
    expect(result.rows.map((r) => r.subject)).toEqual([rust, ownership, react]);
  });

  it("scores the week as a whole rather than averaging the rows", () => {
    // 200% of a 15-minute target beside 10% of a six-hour one is not a 105% week.
    const result = planVsActual(
      [
        { subject: rust, plannedMinutes: 360 },
        { subject: ownership, plannedMinutes: 15 },
      ],
      [
        { subject: rust, minutes: 36 },
        { subject: ownership, minutes: 30 },
      ],
    );
    expect(result.attainment).toBeCloseTo(66 / 375, 10);
  });

  it("breaks a tie between two equal targets deterministically", () => {
    // Two missions with the same target must not swap places between renders. The tiebreak is the
    // subject itself, which is stable.
    const first = planVsActual(
      [
        { subject: react, plannedMinutes: 60 },
        { subject: rust, plannedMinutes: 60 },
      ],
      [],
    );
    const reversed = planVsActual(
      [
        { subject: rust, plannedMinutes: 60 },
        { subject: react, plannedMinutes: 60 },
      ],
      [],
    );
    expect(first.rows.map((r) => r.subject)).toEqual([rust, react]);
    expect(reversed.rows.map((r) => r.subject)).toEqual([rust, react]);
  });

  it("breaks a tie between two equal unplanned totals deterministically", () => {
    const result = planVsActual(
      [],
      [
        { subject: react, minutes: 30 },
        { subject: rust, minutes: 30 },
      ],
    );
    expect(result.rows.map((r) => r.subject)).toEqual([rust, react]);
  });

  it("puts missions before skills when everything else ties", () => {
    // The last tiebreak, exercised on purpose: a comparator that fell through to zero here would
    // leave the order down to the sort implementation.
    const skillTwin = { kind: "skill", id: rust.id } as const;
    const result = planVsActual(
      [
        { subject: skillTwin, plannedMinutes: 60 },
        { subject: rust, plannedMinutes: 60 },
      ],
      [],
    );
    expect(result.rows.map((r) => r.subject.kind)).toEqual(["mission", "skill"]);
  });

  it("rejects negative minutes on either side", () => {
    expect(() => planVsActual([{ subject: rust, plannedMinutes: -1 }], [])).toThrow(RangeError);
    expect(() => planVsActual([], [{ subject: rust, minutes: -1 }])).toThrow(RangeError);
  });
});
