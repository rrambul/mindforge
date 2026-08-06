import { describe, expect, it } from "vitest";
import {
  CreateSkillSchema,
  ListSkillsQuerySchema,
  RateSkillSchema,
  skillSlug,
  UpdateSkillSchema,
} from "./skill.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("CreateSkillSchema", () => {
  it("takes a name alone", () => {
    const parsed = CreateSkillSchema.parse({ name: "Rust ownership" });
    expect(parsed.name).toBe("Rust ownership");
    expect(parsed.prerequisiteIds).toEqual([]);
  });

  it("trims and rejects a blank name", () => {
    expect(CreateSkillSchema.parse({ name: "  kept  " }).name).toBe("kept");
    expect(CreateSkillSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("accepts a self-rating, which is never evidence (FR-S2)", () => {
    expect(CreateSkillSchema.parse({ name: "x", perceivedLevel: 70 }).perceivedLevel).toBe(70);
  });

  it("has no score field at all", () => {
    // The rule the whole feature protects: a score comes from evidence and nothing else, so no client
    // can send one. Zod strips what is not declared, so a score would survive here if it were.
    const parsed = CreateSkillSchema.parse({ name: "x", score: 90, band: "teaching" });
    expect(parsed).not.toHaveProperty("score");
    expect(parsed).not.toHaveProperty("band");
  });

  it("bounds the self-rating to the same 0–100 scale as a score", () => {
    expect(CreateSkillSchema.safeParse({ name: "x", perceivedLevel: 101 }).success).toBe(false);
    expect(CreateSkillSchema.safeParse({ name: "x", perceivedLevel: -1 }).success).toBe(false);
    expect(CreateSkillSchema.parse({ name: "x", perceivedLevel: 0 }).perceivedLevel).toBe(0);
  });

  it("takes prerequisites at creation, when they are most obvious", () => {
    expect(CreateSkillSchema.parse({ name: "x", prerequisiteIds: [UUID] }).prerequisiteIds).toEqual(
      [UUID],
    );
  });
});

describe("UpdateSkillSchema", () => {
  it("rejects a body that changes nothing", () => {
    expect(UpdateSkillSchema.safeParse({}).success).toBe(false);
  });

  it("lets a self-rating be cleared", () => {
    // Retracting a guess is a real thing to want, and it is different from rating yourself zero.
    expect(UpdateSkillSchema.parse({ perceivedLevel: null }).perceivedLevel).toBeNull();
  });

  it("bounds the half-life so decay cannot be switched off", () => {
    // An unbounded half-life is a way to make the dashboard flatter without knowing more, which is
    // exactly what FR-S4 exists to prevent.
    expect(UpdateSkillSchema.safeParse({ halfLifeDays: 100_000 }).success).toBe(false);
    expect(UpdateSkillSchema.safeParse({ halfLifeDays: 0 }).success).toBe(false);
    expect(UpdateSkillSchema.parse({ halfLifeDays: 365 }).halfLifeDays).toBe(365);
  });

  it("still has no score field", () => {
    expect(UpdateSkillSchema.parse({ name: "x", score: 90 })).not.toHaveProperty("score");
  });
});

describe("RateSkillSchema", () => {
  it("takes the rating on its own", () => {
    // The one thing a user updates often, so it gets its own endpoint rather than a general patch.
    expect(RateSkillSchema.parse({ perceivedLevel: "70" }).perceivedLevel).toBe(70);
  });

  it("requires a value rather than defaulting one", () => {
    expect(RateSkillSchema.safeParse({}).success).toBe(false);
  });
});

describe("ListSkillsQuerySchema", () => {
  it("accepts no filter", () => {
    expect(ListSkillsQuerySchema.parse({})).toEqual({});
  });

  it("coerces the overconfidence filter from a query string", () => {
    expect(ListSkillsQuerySchema.parse({ overconfidentOnly: "true" }).overconfidentOnly).toBe(true);
    expect(ListSkillsQuerySchema.parse({ overconfidentOnly: "false" }).overconfidentOnly).toBe(
      false,
    );
  });

  it("rejects a band that is not one", () => {
    expect(ListSkillsQuerySchema.safeParse({ band: "expert" }).success).toBe(false);
  });
});

describe("skillSlug", () => {
  it("makes a URL-safe identifier", () => {
    expect(skillSlug("Rust Ownership")).toBe("rust-ownership");
  });

  it("folds accents rather than dropping the letter", () => {
    // `programação` → `programacao`, not `programao`. This user writes in Portuguese.
    expect(skillSlug("Programação Funcional")).toBe("programacao-funcional");
    expect(skillSlug("Café")).toBe("cafe");
  });

  it("collapses punctuation and runs of separators", () => {
    expect(skillSlug("C++ / Rust: memory!")).toBe("c-rust-memory");
  });

  it("leaves no leading or trailing hyphen", () => {
    expect(skillSlug("  --Rust--  ")).toBe("rust");
  });

  it("leaves no trailing hyphen after truncation", () => {
    // The slice can land mid-separator, which would otherwise produce `...-` and read as a typo.
    const slug = skillSlug(`${"a".repeat(79)} tail`);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(80);
  });

  it("never returns an empty slug", () => {
    // A name made only of characters this drops would otherwise collide on the unique constraint the
    // second time it happened.
    expect(skillSlug("日本語")).toBe("skill");
    expect(skillSlug("!!!")).toBe("skill");
    expect(skillSlug("")).toBe("skill");
  });

  it("is stable, so a stored slug keeps matching", () => {
    expect(skillSlug("Rust Ownership")).toBe(skillSlug("Rust Ownership"));
  });
});
