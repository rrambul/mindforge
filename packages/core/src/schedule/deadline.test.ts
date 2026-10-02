import { describe, expect, it } from "vitest";

import { currentDeadline, deadlineStatus } from "./deadline.js";

const at = (iso: string) => new Date(iso);

describe("currentDeadline", () => {
  it("is null when nothing was ever committed", () => {
    expect(currentDeadline([])).toBeNull();
  });

  it("is the newest commitment, with the first one and how many times it moved", () => {
    expect(
      currentDeadline([
        { dueOn: "2026-10-20", createdAt: at("2026-10-09T10:00:00Z") },
        { dueOn: "2026-10-10", createdAt: at("2026-10-01T10:00:00Z") },
        { dueOn: "2026-10-14", createdAt: at("2026-10-05T10:00:00Z") },
      ]),
    ).toEqual({
      dueOn: "2026-10-20",
      firstDueOn: "2026-10-10",
      moves: 2,
      committedAt: at("2026-10-09T10:00:00Z"),
    });
  });

  it("has not moved when there is one row", () => {
    expect(
      currentDeadline([{ dueOn: "2026-10-10", createdAt: at("2026-10-01T10:00:00Z") }]),
    ).toMatchObject({ dueOn: "2026-10-10", firstDueOn: "2026-10-10", moves: 0 });
  });
});

describe("deadlineStatus", () => {
  const base = { dueOn: "2026-10-10", today: "2026-10-05", finishedOn: null, projectedOn: null };

  it("is met when finished on or before the date", () => {
    expect(deadlineStatus({ ...base, finishedOn: "2026-10-08" })).toEqual({
      kind: "met",
      daysEarly: 2,
    });
    expect(deadlineStatus({ ...base, finishedOn: "2026-10-10" })).toEqual({
      kind: "met",
      daysEarly: 0,
    });
  });

  it("is missed, with how late, when finished after the date", () => {
    expect(deadlineStatus({ ...base, today: "2026-10-20", finishedOn: "2026-10-13" })).toEqual({
      kind: "missed",
      daysLate: 3,
    });
  });

  it("is overdue by the days past the date while unfinished", () => {
    expect(deadlineStatus({ ...base, today: "2026-10-12", projectedOn: "2026-10-15" })).toEqual({
      kind: "overdue",
      daysOver: 2,
    });
  });

  it("is due today on the day", () => {
    expect(deadlineStatus({ ...base, today: "2026-10-10" })).toEqual({ kind: "due-today" });
  });

  it("compares the projection with the date before it arrives", () => {
    expect(deadlineStatus({ ...base, projectedOn: "2026-10-10" })).toEqual({
      kind: "on-track",
      daysLeft: 5,
    });
    expect(deadlineStatus({ ...base, projectedOn: "2026-10-13" })).toEqual({
      kind: "behind",
      daysLeft: 5,
      daysBehind: 3,
    });
  });

  it("says there is no projection rather than guessing either way", () => {
    expect(deadlineStatus(base)).toEqual({ kind: "no-projection", daysLeft: 5 });
  });
});
