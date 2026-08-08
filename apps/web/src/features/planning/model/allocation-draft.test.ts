import { MAX_PLANNED_MINUTES } from "@mindforge/core";
import { describe, expect, it } from "vitest";
import type { AllocationView } from "../api/use-planning.js";
import {
  draftValue,
  orphanedAllocations,
  readDraft,
  readDraftEntry,
  subjectKey,
  type PlanSubjectOption,
} from "./allocation-draft.js";

const RUST: PlanSubjectOption = { kind: "mission", id: "m1", label: "Rust" };
const OWNERSHIP: PlanSubjectOption = { kind: "skill", id: "s1", label: "Ownership" };
const SUBJECTS = [RUST, OWNERSHIP];

const stored: AllocationView[] = [
  { missionId: "m1", skillId: null, plannedMinutes: 240 },
  { missionId: null, skillId: "s1", plannedMinutes: 60 },
];

describe("draftValue", () => {
  it("shows the stored week for a row nobody has touched", () => {
    expect(draftValue("mission:m1", {}, stored)).toBe("240");
  });

  it("shows an empty box for a subject the week never allocated to", () => {
    expect(draftValue("mission:m2", {}, stored)).toBe("");
  });

  it("keeps a cleared box cleared", () => {
    // The whole way a row is removed. `draft[key] || stored` would helpfully undo it, which is the
    // bug this asserts against rather than a hypothetical.
    expect(draftValue("mission:m1", { "mission:m1": "" }, stored)).toBe("");
  });

  it("prefers the edit over the server", () => {
    expect(draftValue("mission:m1", { "mission:m1": "90" }, stored)).toBe("90");
  });
});

describe("readDraftEntry", () => {
  it("reads an empty box as no allocation", () => {
    expect(readDraftEntry("")).toEqual({ state: "empty" });
    expect(readDraftEntry("   ")).toEqual({ state: "empty" });
  });

  it("reads zero as no allocation rather than as a target of nothing", () => {
    // AllocationSchema refuses zero, so a row typed as 0 has to become a removed row — otherwise the
    // save 422s on something the user has no way to interpret.
    expect(readDraftEntry("0")).toEqual({ state: "empty" });
  });

  it("reads whole minutes", () => {
    expect(readDraftEntry("90")).toEqual({ state: "minutes", minutes: 90 });
  });

  it("refuses a fraction, a negative, and a figure past the ceiling", () => {
    expect(readDraftEntry("1.5").state).toBe("invalid");
    expect(readDraftEntry("-5").state).toBe("invalid");
    expect(readDraftEntry(String(MAX_PLANNED_MINUTES + 1)).state).toBe("invalid");
    expect(readDraftEntry("nonsense").state).toBe("invalid");
  });

  it("accepts the ceiling itself", () => {
    expect(readDraftEntry(String(MAX_PLANNED_MINUTES))).toEqual({
      state: "minutes",
      minutes: MAX_PLANNED_MINUTES,
    });
  });
});

describe("readDraft", () => {
  it("names exactly one subject per allocation and omits the other id", () => {
    // AllocationSchema refuses a body naming both, and exactOptionalPropertyTypes makes "absent" and
    // "present but undefined" different things over the wire.
    const { body } = readDraft(SUBJECTS, {}, stored);

    expect(body.allocations).toEqual([
      { missionId: "m1", plannedMinutes: 240 },
      { skillId: "s1", plannedMinutes: 60 },
    ]);
    expect("skillId" in body.allocations[0]!).toBe(false);
  });

  it("drops a cleared row from the week", () => {
    const { body, plannedTotal } = readDraft(SUBJECTS, { "mission:m1": "" }, stored);

    expect(body.allocations).toEqual([{ skillId: "s1", plannedMinutes: 60 }]);
    expect(plannedTotal).toBe(60);
  });

  it("reports an unsendable box instead of silently clamping it", () => {
    const { invalidKeys, body } = readDraft(SUBJECTS, { "mission:m1": "99999" }, stored);

    expect(invalidKeys).toEqual(["mission:m1"]);
    // The rest of the week is still readable, so the screen can say which box is wrong rather than
    // refusing to render.
    expect(body.allocations).toEqual([{ skillId: "s1", plannedMinutes: 60 }]);
  });

  it("is not dirty when the typing means the same as the stored week", () => {
    // "0240" changes the text and not the plan. Offering to save it trains you to press a button
    // that does nothing.
    expect(readDraft(SUBJECTS, { "mission:m1": "0240" }, stored).dirty).toBe(false);
  });

  it("is dirty when a row is cleared", () => {
    expect(readDraft(SUBJECTS, { "mission:m1": "" }, stored).dirty).toBe(true);
  });

  it("is dirty when a row is added to a week that had none", () => {
    expect(readDraft(SUBJECTS, { "skill:s1": "30" }, []).dirty).toBe(true);
  });

  it("is not dirty before anything is typed", () => {
    expect(readDraft(SUBJECTS, {}, stored).dirty).toBe(false);
  });
});

describe("orphanedAllocations", () => {
  it("finds a target whose subject the grid has no row for", () => {
    // A mission parked after the week was planned. It cannot be drawn, and the next save drops it —
    // so the screen has to be able to say so rather than letting a target vanish.
    const orphans = orphanedAllocations([OWNERSHIP], stored);

    expect(orphans).toEqual([{ missionId: "m1", skillId: null, plannedMinutes: 240 }]);
  });

  it("finds none when every allocation has a row", () => {
    expect(orphanedAllocations(SUBJECTS, stored)).toEqual([]);
  });
});

describe("subjectKey", () => {
  it("distinguishes a mission from a skill sharing an id", () => {
    expect(subjectKey({ kind: "mission", id: "x" })).not.toBe(
      subjectKey({ kind: "skill", id: "x" }),
    );
  });
});
