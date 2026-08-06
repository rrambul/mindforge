import { describe, expect, it } from "vitest";
import { FRICTION_TYPES, type FrictionType } from "../friction/classify.js";
import {
  AttributeFrictionSchema,
  COLD_START_CHIPS,
  DEFAULT_FRICTION_INTENSITY,
  INLINE_CHIP_COUNT,
  LogFrictionSchema,
  PINNED_FRICTION_TYPE,
  frictionChips,
} from "./friction.js";

describe("LogFrictionSchema", () => {
  it("needs nothing but a type", () => {
    // This is the ≤5s/≤2-tap budget as a type: one tap sends one field.
    expect(LogFrictionSchema.parse({ type: "tooling" })).toEqual({
      type: "tooling",
      intensity: DEFAULT_FRICTION_INTENSITY,
    });
  });

  it("defaults intensity to 3 rather than asking inline", () => {
    // §5.3: the answer you would give while annoyed is not better than 3, and asking turns
    // a one-tap capture into a two-step form.
    expect(LogFrictionSchema.parse({ type: "interruption" }).intensity).toBe(3);
  });

  it("accepts an intensity when one is supplied later", () => {
    expect(LogFrictionSchema.parse({ type: "tooling", intensity: 5 }).intensity).toBe(5);
    expect(LogFrictionSchema.parse({ type: "tooling", intensity: "4" }).intensity).toBe(4);
  });

  it("rejects an intensity outside the scale", () => {
    expect(LogFrictionSchema.safeParse({ type: "tooling", intensity: 0 }).success).toBe(false);
    expect(LogFrictionSchema.safeParse({ type: "tooling", intensity: 6 }).success).toBe(false);
    expect(LogFrictionSchema.safeParse({ type: "tooling", intensity: 3.5 }).success).toBe(false);
  });

  it("rejects a type outside the taxonomy", () => {
    // The 11 types are the analysis unit. A free-text type would make the ratio
    // uncomputable and the chips unrankable.
    expect(LogFrictionSchema.safeParse({ type: "annoyed" }).success).toBe(false);
  });

  it("accepts every type in the taxonomy", () => {
    for (const type of FRICTION_TYPES) {
      expect(LogFrictionSchema.safeParse({ type }).success, type).toBe(true);
    }
  });

  it("takes a client-generated id, so a replayed tap is not a second event", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(LogFrictionSchema.parse({ type: "tooling", id }).id).toBe(id);
    expect(LogFrictionSchema.safeParse({ type: "tooling", id: "nope" }).success).toBe(false);
  });

  it("carries its own timestamp, so an offline afternoon is not a burst at reconnect", () => {
    const occurredAt = new Date("2026-08-05T12:00:00Z");
    expect(LogFrictionSchema.parse({ type: "tooling", occurredAt }).occurredAt).toEqual(occurredAt);
    // Serialised through JSON on the way out of the queue.
    expect(
      LogFrictionSchema.parse({ type: "tooling", occurredAt: "2026-08-05T12:00:00.000Z" })
        .occurredAt,
    ).toEqual(occurredAt);
  });

  it("normalises an empty note to null rather than storing a blank", () => {
    expect(LogFrictionSchema.parse({ type: "tooling", note: null }).note).toBeNull();
    expect(LogFrictionSchema.parse({ type: "tooling", note: "  broke again  " }).note).toBe(
      "broke again",
    );
  });
});

describe("frictionChips", () => {
  it("shows exactly four inline, because eleven is not a one-tap UI at 375px", () => {
    const { inline, overflow } = frictionChips({});
    expect(inline).toHaveLength(INLINE_CHIP_COUNT);
    expect(inline.length + overflow.length).toBe(FRICTION_TYPES.length);
  });

  it("pins productive struggle last, always", () => {
    // §5.3: the type people under-report and the one the product most needs. If it had to
    // rank on usage it would never appear, and the ember share would then describe the
    // interface rather than the learner.
    expect(frictionChips({}).inline.at(-1)).toBe(PINNED_FRICTION_TYPE);

    const heavilyUsed: Partial<Record<FrictionType, number>> = {
      interruption: 99,
      tooling: 98,
      too_hard: 97,
      avoidance: 96,
      physical: 95,
    };
    expect(frictionChips(heavilyUsed).inline.at(-1)).toBe(PINNED_FRICTION_TYPE);
  });

  it("never lets the pinned type appear twice", () => {
    // It is excluded from the ranking and appended, so heavy use must not duplicate it.
    const chips = frictionChips({ productive_struggle: 500 });
    expect(chips.inline.filter((type) => type === PINNED_FRICTION_TYPE)).toHaveLength(1);
    expect(chips.overflow).not.toContain(PINNED_FRICTION_TYPE);
  });

  it("promotes the three most-used types", () => {
    const chips = frictionChips({
      physical: 10,
      decision_fatigue: 9,
      unclear_material: 8,
      tooling: 1,
    });
    expect(chips.inline).toEqual([
      "physical",
      "decision_fatigue",
      "unclear_material",
      PINNED_FRICTION_TYPE,
    ]);
  });

  it("matches the documented cold start when there is no usage yet", () => {
    expect(frictionChips({}).inline).toEqual(COLD_START_CHIPS);
  });

  it("breaks ties deterministically, so chips do not reshuffle between renders", () => {
    // Muscle memory is the entire point of a one-tap control; chips that move are unusable.
    // Ties are the normal case, not the edge one: a new account has eleven zeroes.
    const a = frictionChips({ tooling: 5, interruption: 5, too_hard: 5 });
    const b = frictionChips({ too_hard: 5, interruption: 5, tooling: 5 });
    expect(a.inline).toEqual(b.inline);
    expect(a.inline).toEqual(COLD_START_CHIPS);
  });

  it("prefers the cold-start types over the rest when counts are equal", () => {
    // Raw declaration order would surface self_interruption here, which §5.3 does not ask
    // for. The stated preference is encoded rather than left to coincide with an array.
    const chips = frictionChips({ self_interruption: 0, tooling: 0 });
    expect(chips.inline).toEqual(COLD_START_CHIPS);
    expect(chips.overflow[0]).toBe("self_interruption");
  });

  it("ignores a type it does not know about", () => {
    const counts = { tooling: 3, nonsense: 999 } as Partial<Record<FrictionType, number>>;
    expect(frictionChips(counts).inline).toContain("tooling");
    expect(frictionChips(counts).inline).not.toContain("nonsense" as FrictionType);
  });

  it("puts every type somewhere, so More is never a dead end", () => {
    const chips = frictionChips({ physical: 3 });
    const all = [...chips.inline, ...chips.overflow].sort();
    expect(all).toEqual([...FRICTION_TYPES].sort());
  });
});

describe("AttributeFrictionSchema (§5.3)", () => {
  const UUID = "11111111-1111-4111-8111-111111111111";

  it("takes a skill, a resource, or both", () => {
    expect(AttributeFrictionSchema.parse({ skillId: UUID }).skillId).toBe(UUID);
    expect(AttributeFrictionSchema.parse({ resourceId: UUID }).resourceId).toBe(UUID);

    const both = AttributeFrictionSchema.parse({ skillId: UUID, resourceId: UUID });
    expect(both.skillId).toBe(UUID);
    expect(both.resourceId).toBe(UUID);
  });

  it("accepts null, so an attribution can be retracted", () => {
    // "Actually this was not about that skill" has to be sayable, or a wrong guess is permanent.
    expect(AttributeFrictionSchema.parse({ skillId: null }).skillId).toBeNull();
  });

  it("distinguishes absent from null", () => {
    // Absent means unchanged, which is what lets the two pickers be set independently — sending one
    // must not clear the other.
    const parsed = AttributeFrictionSchema.parse({ skillId: UUID });
    expect(parsed.resourceId).toBeUndefined();
  });

  it("rejects a body that names nothing", () => {
    // An empty patch is a mistake rather than an instruction; there is nothing it could mean.
    expect(AttributeFrictionSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an id that is not a uuid", () => {
    expect(AttributeFrictionSchema.safeParse({ skillId: "rust" }).success).toBe(false);
  });

  it("has no field for the type or the moment", () => {
    // The type and the moment are what you tapped. Revising them afterwards would make the friction
    // record a story rather than a log.
    const parsed = AttributeFrictionSchema.parse({
      skillId: UUID,
      type: "avoidance",
      occurredAt: "2026-08-06T12:00:00.000Z",
      intensity: 5,
    });

    expect(parsed).not.toHaveProperty("type");
    expect(parsed).not.toHaveProperty("occurredAt");
    expect(parsed).not.toHaveProperty("intensity");
  });
});
