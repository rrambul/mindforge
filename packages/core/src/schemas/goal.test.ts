import { describe, expect, it } from "vitest";
import {
  CloseGoalSchema,
  CreateGoalSchema,
  CreateGoalTargetSchema,
  GOAL_STATUS_ORDER,
  GOAL_STATUSES,
  goalStatusRank,
  ListGoalsQuerySchema,
  MEASURABLE_KINDS_M1,
  SUBJECT_FOR_KIND,
  TARGET_KINDS,
  TargetDefinitionSchema,
  UpdateGoalSchema,
} from "./goal.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("CreateGoalSchema", () => {
  it("takes a title alone", () => {
    // A goal you have written down but not yet worked out how to measure is a real state, and
    // refusing it would mean losing the goal rather than gaining a target.
    const parsed = CreateGoalSchema.parse({ title: "Ship the parser" });
    expect(parsed.targets).toEqual([]);
    expect(parsed.targetDate).toBeUndefined();
  });

  it("trims and rejects a blank title", () => {
    expect(CreateGoalSchema.parse({ title: "  kept  " }).title).toBe("kept");
    expect(CreateGoalSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("has no percentage field and no slider anywhere", () => {
    // The rule the whole feature serves (§3.8, FR-M3): a hand-entered number is self-report wearing
    // a number's clothes. This asserts the shape rather than trusting the reviewer to notice.
    // The extra keys are the point: Zod strips what the schema does not declare, so if a percentage
    // field were ever added they would survive and this would fail.
    const parsed = CreateGoalSchema.parse({
      title: "x",
      progress: 80,
      percent: 80,
      completion: 0.8,
    });

    expect(parsed).not.toHaveProperty("progress");
    expect(parsed).not.toHaveProperty("percent");
    expect(parsed).not.toHaveProperty("completion");
  });

  it("takes targets at creation", () => {
    const parsed = CreateGoalSchema.parse({
      title: "Read it properly",
      targets: [{ kind: "resource_progress", resourceId: UUID, target: { percent: 100 } }],
    });
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0]?.weight).toBe(1);
  });

  it("caps the number of targets", () => {
    const targets = Array.from({ length: 21 }, () => ({ kind: "manual", target: {} }));
    expect(CreateGoalSchema.safeParse({ title: "x", targets }).success).toBe(false);
  });

  describe("targetDate", () => {
    it("takes a calendar day, not an instant", () => {
      // "By the 14th" is a day in the user's own calendar. Coercing it through a Date would make it
      // midnight UTC — the 13th for anyone west of it, which is a whole day of wrongness.
      expect(CreateGoalSchema.parse({ title: "x", targetDate: "2026-08-14" }).targetDate).toBe(
        "2026-08-14",
      );
    });

    it("rejects a timestamp or a malformed day", () => {
      for (const bad of ["2026-08-14T00:00:00Z", "14/08/2026", "2026-8-4", "tomorrow", ""]) {
        expect(CreateGoalSchema.safeParse({ title: "x", targetDate: bad }).success, bad).toBe(
          false,
        );
      }
    });

    it("rejects a day that does not exist", () => {
      expect(CreateGoalSchema.safeParse({ title: "x", targetDate: "2026-13-01" }).success).toBe(
        false,
      );
    });
  });
});

describe("TargetDefinitionSchema", () => {
  it("requires the subject its kind points at", () => {
    // A `resource_progress` target with no resource measures nothing, and would sit in the list
    // looking like a target forever.
    expect(
      TargetDefinitionSchema.safeParse({ kind: "resource_progress", target: { percent: 50 } })
        .success,
    ).toBe(false);
    expect(
      TargetDefinitionSchema.safeParse({ kind: "skill_band", target: { band: "fluent" } }).success,
    ).toBe(false);
    expect(
      TargetDefinitionSchema.safeParse({ kind: "focus_hours", target: { hours: 40 } }).success,
    ).toBe(false);
  });

  it("takes no subject for the kinds that stand alone", () => {
    expect(TargetDefinitionSchema.safeParse({ kind: "manual", target: {} }).success).toBe(true);
    expect(TargetDefinitionSchema.safeParse({ kind: "artifact", target: {} }).success).toBe(true);
  });

  it("rejects a target whose parameters belong to another kind", () => {
    // `{hours: 40}` on a band target would parse under a looser schema and then read as band
    // `undefined` — a target that can never be met and never says why.
    expect(
      TargetDefinitionSchema.safeParse({ kind: "skill_band", skillId: UUID, target: { hours: 40 } })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown kind rather than storing free text", () => {
    expect(TargetDefinitionSchema.safeParse({ kind: "vibes", target: {} }).success).toBe(false);
  });

  describe("percent", () => {
    it("refuses 0, which is a target already met", () => {
      expect(
        TargetDefinitionSchema.safeParse({
          kind: "resource_progress",
          resourceId: UUID,
          target: { percent: 0 },
        }).success,
      ).toBe(false);
    });

    it("refuses more than 100, which cannot be reached", () => {
      expect(
        TargetDefinitionSchema.safeParse({
          kind: "resource_progress",
          resourceId: UUID,
          target: { percent: 120 },
        }).success,
      ).toBe(false);
    });
  });

  describe("accuracy", () => {
    it("defaults the window, because a rolling accuracy without one measures nothing", () => {
      // "85% accurate" over all time says nothing about whether you know it now.
      const parsed = TargetDefinitionSchema.parse({
        kind: "review_accuracy",
        skillId: UUID,
        target: { accuracy: 0.85 },
      });
      expect(parsed.kind === "review_accuracy" && parsed.target.windowDays).toBe(30);
    });

    it("refuses an accuracy of zero, which every performance meets", () => {
      // It also divides by zero in the derivation, which reported the target as met beside an empty
      // bar — a contradiction rendered on one row.
      expect(
        TargetDefinitionSchema.safeParse({
          kind: "review_accuracy",
          skillId: UUID,
          target: { accuracy: 0 },
        }).success,
      ).toBe(false);
    });

    it("keeps accuracy a fraction rather than a percentage", () => {
      expect(
        TargetDefinitionSchema.safeParse({
          kind: "review_accuracy",
          skillId: UUID,
          target: { accuracy: 85 },
        }).success,
      ).toBe(false);
    });
  });

  it("refuses zero or negative hours and counts", () => {
    expect(
      TargetDefinitionSchema.safeParse({
        kind: "focus_hours",
        missionId: UUID,
        target: { hours: 0 },
      }).success,
    ).toBe(false);
    expect(
      TargetDefinitionSchema.safeParse({
        kind: "lessons_completed",
        missionId: UUID,
        target: { count: -1 },
      }).success,
    ).toBe(false);
  });
});

describe("CreateGoalTargetSchema", () => {
  it("weights every target equally by default", () => {
    expect(CreateGoalTargetSchema.parse({ kind: "manual", target: {} }).weight).toBe(1);
  });

  it("refuses a weight of zero, which is a target that cannot count", () => {
    expect(
      CreateGoalTargetSchema.safeParse({ kind: "manual", target: {}, weight: 0 }).success,
    ).toBe(false);
  });

  it("bounds the weight so one target cannot swamp the mean", () => {
    // A weighted mean where one term is 9999 is a single number wearing a mean's clothes.
    expect(
      CreateGoalTargetSchema.safeParse({ kind: "manual", target: {}, weight: 9_999 }).success,
    ).toBe(false);
  });

  it("takes a client-minted id", () => {
    expect(CreateGoalTargetSchema.parse({ id: UUID, kind: "manual", target: {} }).id).toBe(UUID);
  });
});

describe("CloseGoalSchema", () => {
  it("requires a note for a missed goal", () => {
    // What stopped you is the thing worth reading later. Without it the row records only that
    // something did not happen, which nobody can act on.
    expect(CloseGoalSchema.safeParse({ status: "missed" }).success).toBe(false);
    expect(
      CloseGoalSchema.safeParse({ status: "missed", outcomeNote: "ran out of time" }).success,
    ).toBe(true);
  });

  it("requires a note for an abandoned goal", () => {
    expect(CloseGoalSchema.safeParse({ status: "abandoned" }).success).toBe(false);
  });

  it("does not require one for a met goal, which usually speaks for itself", () => {
    expect(CloseGoalSchema.safeParse({ status: "met" }).success).toBe(true);
  });

  it("puts the error on the note, so the form can mark the right field", () => {
    const result = CloseGoalSchema.safeParse({ status: "missed" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["outcomeNote"]);
  });

  it("will not reopen a goal through this route", () => {
    // Closing and reopening are different decisions; letting one endpoint do both means a stray
    // request can quietly resurrect something you decided to stop.
    expect(CloseGoalSchema.safeParse({ status: "active" }).success).toBe(false);
  });
});

describe("UpdateGoalSchema", () => {
  it("accepts a single field", () => {
    expect(UpdateGoalSchema.parse({ title: "Revised" }).title).toBe("Revised");
  });

  it("rejects a body that changes nothing", () => {
    expect(UpdateGoalSchema.safeParse({}).success).toBe(false);
  });

  it("lets the target date and the mission be cleared", () => {
    expect(UpdateGoalSchema.parse({ targetDate: null }).targetDate).toBeNull();
    expect(UpdateGoalSchema.parse({ missionId: null }).missionId).toBeNull();
  });
});

describe("ListGoalsQuerySchema", () => {
  it("accepts no filter", () => {
    expect(ListGoalsQuerySchema.parse({})).toEqual({});
  });

  it("filters by status and mission", () => {
    const parsed = ListGoalsQuerySchema.parse({ status: "active", missionId: UUID });
    expect(parsed.status).toBe("active");
  });

  it("rejects a status that is not one", () => {
    expect(ListGoalsQuerySchema.safeParse({ status: "whatever" }).success).toBe(false);
  });
});

describe("GOAL_STATUS_ORDER", () => {
  it("puts what is live first and what is over last", () => {
    expect(goalStatusRank("active")).toBeLessThan(goalStatusRank("met"));
    expect(goalStatusRank("met")).toBeLessThan(goalStatusRank("abandoned"));
  });

  it("covers every status the schema allows", () => {
    // A status with no rank would sort as -1 and jump to the top of the list.
    expect([...GOAL_STATUS_ORDER].sort()).toEqual([...GOAL_STATUSES].sort());
  });
});

describe("SUBJECT_FOR_KIND", () => {
  it("names a subject for every kind, so the UI can never ask for the wrong one", () => {
    for (const kind of TARGET_KINDS) {
      expect(kind in SUBJECT_FOR_KIND, kind).toBe(true);
    }
  });

  it("agrees with what the schema requires", () => {
    // The map drives which picker the form shows; the schema decides what is accepted. Disagreement
    // means a form that collects a field the server rejects.
    expect(SUBJECT_FOR_KIND.resource_progress).toBe("resource");
    expect(SUBJECT_FOR_KIND.focus_hours).toBe("mission");
    expect(SUBJECT_FOR_KIND.manual).toBeNull();
  });
});

describe("MEASURABLE_KINDS_M1", () => {
  it("lists only kinds whose source exists in M1", () => {
    // Everything else can still be created — writing down "ship a thing" is honest — it just reports
    // unmeasurable rather than 0% until the feature that feeds it lands.
    expect([...MEASURABLE_KINDS_M1].sort()).toEqual(["focus_hours", "manual", "resource_progress"]);
  });

  it("names only kinds the schema knows", () => {
    for (const kind of MEASURABLE_KINDS_M1) {
      expect(TARGET_KINDS).toContain(kind);
    }
  });
});
