import type { NotificationKind } from "@mindforge/core";
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

  it("accepts the name `detectStalls` actually computes", () => {
    expect(nudgeMessage(nudge("stall", { missionTopic: "Rust", untouchedDays: 12 })).args).toEqual({
      missionTopic: "Rust",
      days: 12,
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
