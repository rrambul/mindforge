import { StallPayloadSchema, type NotificationKind } from "@mindforge/core";
import { describe, expect, it } from "vitest";
import type { Nudge } from "../api/use-notifications.js";
import { nudgeMessage } from "./message.js";

function nudge(kind: NotificationKind, payload: Record<string, unknown>): Nudge {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind,
    payload,
    subjectType: null,
    subjectId: null,
    createdAt: "2026-08-07T12:00:00.000Z",
    dismissedAt: null,
  };
}

describe("nudgeMessage", () => {
  it("passes the payload through as ICU arguments, never as text", () => {
    // The row carries arguments and the sentence lives in the bundle, which is what lets the same
    // nudge read in either language (§5.2).
    expect(nudgeMessage(nudge("stall", { missionTopic: "Rust ownership", days: 14 }))).toEqual({
      key: "stall",
      args: { missionTopic: "Rust ownership", days: 14 },
    });
  });

  it("no longer accepts the domain's own field name, and should not", () => {
    // This used to read `untouchedDays` as well as `days`, described as costing one line and saving
    // a nudge from the anonymous fallback. It was papering over the real defect: the worker wrote
    // `topic`, not `missionTopic`, so the leniency never helped and the fallback fired anyway.
    //
    // With `StallPayloadSchema` as the contract on both sides, `untouchedDays` cannot be written,
    // and accepting it would only hide the next drift the same way.
    expect(nudgeMessage(nudge("stall", { missionTopic: "Rust", untouchedDays: 12 }))).toEqual({
      key: "stallUndated",
      args: { missionTopic: "Rust" },
    });
  });

  it("drops to a sentence that needs no day count when the payload has none", () => {
    // ICU throws on a missing argument, and these rows are written by a job that does not exist yet
    // (M3). One absent field must not be able to blank the whole list.
    expect(nudgeMessage(nudge("stall", { missionTopic: "Rust" }))).toEqual({
      key: "stallUndated",
      args: { missionTopic: "Rust" },
    });
  });

  it("names no mission rather than inventing one", () => {
    expect(nudgeMessage(nudge("stall", {}))).toEqual({ key: "stallUnnamed", args: {} });
    expect(nudgeMessage(nudge("stall", { missionTopic: "   " })).key).toBe("stallUnnamed");
  });

  it("ignores a day count that is not a number", () => {
    expect(nudgeMessage(nudge("stall", { missionTopic: "Rust", days: "14" })).key).toBe(
      "stallUndated",
    );
  });

  it("gives the weekly review nudge no arguments to get wrong", () => {
    // It is about the week rather than about a thing in it, so extra payload fields are ignored.
    expect(nudgeMessage(nudge("weekly_review", { weekStart: "2026-08-03" }))).toEqual({
      key: "weeklyReview",
      args: {},
    });
  });
});

describe("the payload contract with the worker", () => {
  it("renders the named message from exactly what StallPayloadSchema produces", () => {
    // The regression this file exists for. The worker wrote `{ topic, untouchedDays }` and this
    // module read `missionTopic`, so every stall nudge rendered the anonymous fallback — and both
    // suites stayed green, because each asserted its own spelling. Building the fixture *through*
    // the shared schema is what ties them together: a rename that misses one side stops compiling.
    const payload = StallPayloadSchema.parse({
      missionTopic: "Writing that people finish",
      days: 23,
    });

    expect(nudgeMessage(nudge("stall", payload))).toEqual({
      key: "stall",
      args: { missionTopic: "Writing that people finish", days: 23 },
    });
  });

  it("falls back to the anonymous message rather than crashing on an older payload", () => {
    // A row written before the schema existed still has to render something. `safeParse`, not
    // `parse`: a bar that throws over one stale nudge is worse than a vague sentence.
    expect(nudgeMessage(nudge("stall", { topic: "old", untouchedDays: 9 }))).toEqual({
      key: "stallUnnamed",
      args: {},
    });
  });
});
