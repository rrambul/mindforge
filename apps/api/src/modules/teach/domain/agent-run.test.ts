import { describe, expect, it } from "vitest";

import {
  ACTIVE_STATUSES,
  canTransition,
  HEARTBEAT_TIMEOUT_MS,
  isActive,
  isStale,
  isTerminal,
  type AgentRun,
  type AgentRunStatus,
} from "./agent-run.js";

const NOW = new Date("2026-08-08T12:00:00.000Z");

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    userId: "user-1",
    missionId: "mission-1",
    kind: "generate_lesson",
    status: "running",
    input: null,
    result: null,
    error: null,
    createdAt: new Date("2026-08-08T11:00:00.000Z"),
    startedAt: new Date("2026-08-08T11:00:00.000Z"),
    heartbeatAt: new Date("2026-08-08T11:59:00.000Z"),
    finishedAt: null,
    ...overrides,
  };
}

describe("which statuses occupy a mission", () => {
  it("counts queued and running, and nothing else", () => {
    // These are the two the partial unique index names. Adding a status here
    // without adding it there — or the reverse — is how a mission ends up either
    // teachable twice at once or never again.
    expect([...ACTIVE_STATUSES]).toEqual(["queued", "running"]);
  });

  it("treats a conflicted success as finished", () => {
    // §7.4: the run did its work and kept both versions. Counting it as active
    // would wedge the mission until somebody resolved a conflict, turning an
    // honest outcome into a blocker — and pushing people toward re-running, which
    // makes more conflicts.
    expect(isActive("succeeded_with_conflicts")).toBe(false);
    expect(isTerminal("succeeded_with_conflicts")).toBe(true);
  });

  it("agrees with itself about every status", () => {
    const all: AgentRunStatus[] = [
      "queued",
      "running",
      "succeeded",
      "succeeded_with_conflicts",
      "failed",
      "cancelled",
    ];
    for (const status of all) expect(isActive(status)).toBe(!isTerminal(status));
  });
});

describe("canTransition", () => {
  it("lets a queued run be claimed", () => {
    expect(canTransition("queued", "running")).toBe(true);
  });

  it("lets a running run reach any of its four endings", () => {
    for (const ending of [
      "succeeded",
      "succeeded_with_conflicts",
      "failed",
      "cancelled",
    ] as const) {
      expect(canTransition("running", ending)).toBe(true);
    }
  });

  it("lets a queued run be cancelled or failed without ever starting", () => {
    // A user who changes their mind before a dispatcher picks it up, and a
    // dispatcher that cannot materialise the workspace at all.
    expect(canTransition("queued", "cancelled")).toBe(true);
    expect(canTransition("queued", "failed")).toBe(true);
  });

  it("refuses to move a finished run at all", () => {
    // The rule that makes a late message from a reaped worker a no-op rather than
    // a resurrection. A run brought back to `running` would write to a workspace a
    // newer run now owns.
    for (const finished of [
      "succeeded",
      "succeeded_with_conflicts",
      "failed",
      "cancelled",
    ] as const) {
      expect(canTransition(finished, "running")).toBe(false);
      expect(canTransition(finished, "succeeded")).toBe(false);
    }
  });

  it("refuses to re-queue a running run", () => {
    expect(canTransition("running", "queued")).toBe(false);
  });
});

describe("isStale", () => {
  it("is false while the heartbeat is recent", () => {
    expect(isStale(run(), NOW)).toBe(false);
  });

  it("is true once the heartbeat is older than the timeout", () => {
    const silent = run({ heartbeatAt: new Date(NOW.getTime() - HEARTBEAT_TIMEOUT_MS - 1) });
    expect(isStale(silent, NOW)).toBe(true);
  });

  it("measures a claimed-but-silent run from when it started", () => {
    // A worker that claimed a run and died before its first message has no
    // heartbeat at all. Treating a null as fresh would hold the mission forever —
    // which is precisely the failure the reaper exists for.
    const neverReported = run({
      heartbeatAt: null,
      startedAt: new Date(NOW.getTime() - HEARTBEAT_TIMEOUT_MS - 1),
    });
    expect(isStale(neverReported, NOW)).toBe(true);
  });

  it("is true when a running run has neither timestamp", () => {
    expect(isStale(run({ heartbeatAt: null, startedAt: null }), NOW)).toBe(true);
  });

  it("never reaps a run that is only queued", () => {
    // A queued run has no worker to have died. Failing it would kill work nobody
    // has started, and the dispatcher would have nothing to pick up.
    const queued = run({ status: "queued", heartbeatAt: null, startedAt: null });
    expect(isStale(queued, NOW)).toBe(false);
  });

  it("never reaps a run that has already finished", () => {
    for (const finished of ["succeeded", "failed", "cancelled"] as const) {
      expect(isStale(run({ status: finished, heartbeatAt: null }), NOW)).toBe(false);
    }
  });

  it("is exclusive at the boundary, so a run exactly at the timeout survives", () => {
    // Arbitrary but worth pinning: the alternative is a run reaped on the tick it
    // was about to report, which reads as a flaky worker.
    const exactly = run({ heartbeatAt: new Date(NOW.getTime() - HEARTBEAT_TIMEOUT_MS) });
    expect(isStale(exactly, NOW)).toBe(false);
  });
});
