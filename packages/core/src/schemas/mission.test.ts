import { describe, expect, it } from "vitest";
import {
  CreateMissionSchema,
  ListMissionsQuerySchema,
  MISSION_CONTENT_FIELDS,
  MISSION_STATUSES,
  MISSION_WIP_LIMIT,
  MissionFieldsSchema,
  MissionStatusSchema,
  UpdateMissionSchema,
} from "./mission.js";

describe("MISSION_WIP_LIMIT", () => {
  it("is 3, per FR-M4", () => {
    // Lives here rather than in the API so the SPA can disable "new mission" before
    // a submit fails, instead of surfacing a 409 the user could have been spared.
    expect(MISSION_WIP_LIMIT).toBe(3);
  });
});

describe("MissionStatusSchema", () => {
  it("accepts every status the schema stores", () => {
    for (const status of MISSION_STATUSES) {
      expect(MissionStatusSchema.parse(status)).toBe(status);
    }
  });

  it("rejects display text, because statuses are keys", () => {
    // The UI translates at render (§5.2). If "Parked" ever parsed, a locale change
    // would start writing different values into the column.
    expect(MissionStatusSchema.safeParse("Parked").success).toBe(false);
    expect(MissionStatusSchema.safeParse("Pausada").success).toBe(false);
  });
});

describe("CreateMissionSchema", () => {
  it("requires only a topic and defaults the prose fields to null", () => {
    expect(CreateMissionSchema.parse({ topic: "Rust ownership" })).toEqual({
      topic: "Rust ownership",
      why: null,
      successLooksLike: null,
      constraints: null,
      currentLevel: null,
    });
  });

  it("trims before validating, so whitespace cannot pass a length check", () => {
    // "   " would otherwise satisfy min(3) and store as blank.
    expect(CreateMissionSchema.parse({ topic: "  Rust ownership  " }).topic).toBe("Rust ownership");
    expect(CreateMissionSchema.safeParse({ topic: "     " }).success).toBe(false);
  });

  it("normalises an empty prose field to null", () => {
    // So "" and null cannot both mean absent, which every read would then check for.
    expect(CreateMissionSchema.parse({ topic: "Rust", why: "   " }).why).toBeNull();
    expect(CreateMissionSchema.parse({ topic: "Rust", why: "" }).why).toBeNull();
  });

  it("accepts an explicit null for a prose field", () => {
    expect(CreateMissionSchema.parse({ topic: "Rust", why: null }).why).toBeNull();
  });

  it("rejects a topic below the floor and above the ceiling", () => {
    expect(CreateMissionSchema.safeParse({ topic: "no" }).success).toBe(false);
    expect(CreateMissionSchema.safeParse({ topic: "x".repeat(201) }).success).toBe(false);
    expect(CreateMissionSchema.safeParse({ topic: "x".repeat(200) }).success).toBe(true);
  });

  it("caps prose so a paste cannot become an unbounded write", () => {
    expect(CreateMissionSchema.safeParse({ topic: "Rust", why: "x".repeat(4_001) }).success).toBe(
      false,
    );
    expect(CreateMissionSchema.safeParse({ topic: "Rust", why: "x".repeat(4_000) }).success).toBe(
      true,
    );
  });

  it("strips keys a client is not allowed to set", () => {
    const parsed = CreateMissionSchema.parse({
      topic: "Rust",
      status: "completed",
      userId: "someone-else",
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("userId");
  });

  it("rejects a missing topic", () => {
    expect(CreateMissionSchema.safeParse({ why: "no topic" }).success).toBe(false);
  });
});

describe("MissionFieldsSchema", () => {
  it("requires every field, unlike the create schema", () => {
    // This is the whole-mission shape the teach workspace round-trips through
    // (FR-T2), where an absent field and a null one are genuinely different.
    expect(MissionFieldsSchema.safeParse({ topic: "Rust" }).success).toBe(false);
    expect(
      MissionFieldsSchema.safeParse({
        topic: "Rust",
        why: null,
        successLooksLike: null,
        constraints: null,
        currentLevel: null,
      }).success,
    ).toBe(true);
  });
});

describe("UpdateMissionSchema", () => {
  it("accepts a single field", () => {
    expect(UpdateMissionSchema.parse({ topic: "Rust lifetimes" })).toEqual({
      topic: "Rust lifetimes",
    });
  });

  it("keeps an omitted field absent rather than nulling it", () => {
    // `undefined` means leave alone; `null` means clear. This is what lets PATCH
    // erase a `why` without a second endpoint, and the two must not collapse.
    const parsed = UpdateMissionSchema.parse({ topic: "Rust" });
    expect("why" in parsed).toBe(false);
  });

  it("carries an explicit null through as a clear", () => {
    expect(UpdateMissionSchema.parse({ why: null }).why).toBeNull();
  });

  it("treats an emptied prose field as a clear", () => {
    expect(UpdateMissionSchema.parse({ why: "  " }).why).toBeNull();
  });

  it("accepts an optional reason", () => {
    expect(UpdateMissionSchema.parse({ topic: "Rust", reason: "narrowed scope" }).reason).toBe(
      "narrowed scope",
    );
  });

  it("rejects a body with no field to change", () => {
    expect(UpdateMissionSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a reason with nothing to justify", () => {
    // A revision recording a reason for a change that did not happen is history
    // about nothing.
    expect(UpdateMissionSchema.safeParse({ reason: "because" }).success).toBe(false);
  });

  it("attaches the empty-body error to a field a form can show it on", () => {
    const result = UpdateMissionSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["topic"]);
  });

  it("still validates the fields it was given", () => {
    expect(UpdateMissionSchema.safeParse({ topic: "no" }).success).toBe(false);
  });

  it("caps the reason", () => {
    expect(UpdateMissionSchema.safeParse({ topic: "Rust", reason: "" }).success).toBe(false);
    expect(UpdateMissionSchema.safeParse({ topic: "Rust", reason: "x".repeat(501) }).success).toBe(
      false,
    );
  });
});

describe("ListMissionsQuerySchema", () => {
  it("treats status as optional", () => {
    expect(ListMissionsQuerySchema.parse({})).toEqual({});
  });

  it("accepts a known status", () => {
    expect(ListMissionsQuerySchema.parse({ status: "parked" }).status).toBe("parked");
  });

  it("rejects an unknown one rather than ignoring it", () => {
    // Silently dropping it would return every mission to a caller that asked for a
    // subset — a filter that quietly does nothing is worse than an error.
    expect(ListMissionsQuerySchema.safeParse({ status: "nonsense" }).success).toBe(false);
  });
});

describe("MISSION_CONTENT_FIELDS", () => {
  it("lists what counts as drift, and excludes status", () => {
    // FR-M2 is about the mission's content changing. Parking is a status change and
    // filing it as drift would make the drift count meaningless.
    expect([...MISSION_CONTENT_FIELDS]).toEqual([
      "topic",
      "why",
      "successLooksLike",
      "constraints",
      "currentLevel",
    ]);
  });

  it("covers every field in the mission shape", () => {
    // A field added to MissionFieldsSchema without being added here would change
    // silently and never appear in the history.
    const shapeKeys = Object.keys(MissionFieldsSchema.shape).sort();
    expect([...MISSION_CONTENT_FIELDS].sort()).toEqual(shapeKeys);
  });
});
