import { describe, expect, it } from "vitest";
import { Skill, type SkillSnapshot } from "./skill.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-06T12:00:00Z");
const daysLater = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function created(perceivedLevel: number | null = null): Skill {
  return Skill.create({
    id: ID,
    userId: USER,
    name: "Rust ownership",
    slug: "rust-ownership",
    description: null,
    perceivedLevel,
    now: NOW,
  });
}

function withScore(overrides: Partial<SkillSnapshot> = {}): Skill {
  return Skill.fromSnapshot({
    id: ID,
    userId: USER,
    name: "Rust ownership",
    slug: "rust-ownership",
    description: null,
    perceivedLevel: null,
    score: null,
    scoreStdDev: null,
    halfLifeDays: 90,
    lastEvidenceAt: null,
    createdAt: NOW,
    ...overrides,
  });
}

describe("a score cannot be set (FR-S2)", () => {
  it("starts unproven rather than at zero", () => {
    // "No evidence" and "evidence that you score zero" are different claims, and conflating them is
    // the dishonesty this product exists to avoid.
    const skill = created();
    expect(skill.score).toBeNull();
    expect(skill.currentScore(NOW)).toBeNull();
    expect(skill.currentBand(NOW)).toBeNull();
  });

  it("has no setter for it", () => {
    // The invariant the class exists to hold. A rating that could move the score would make FR-S5's
    // gap measure nothing — the two terms would rise together by construction.
    const skill = created() as unknown as Record<string, unknown>;
    for (const name of ["setScore", "score = ", "recordEvidence", "setBand"]) {
      expect(typeof skill[name]).not.toBe("function");
    }
  });

  it("does not move when a rating is set", () => {
    const skill = withScore({ score: 40, lastEvidenceAt: NOW });
    skill.rate(95);

    expect(skill.currentScore(NOW)).toBe(40);
    expect(skill.perceivedLevel).toBe(95);
  });

  it("does not include the score in what a rating writes", () => {
    // Asserted on the snapshot the repository persists, because that is the surface a stray line would
    // have to cross for a rating to leak into evidence.
    const skill = withScore({ score: 40, lastEvidenceAt: NOW });
    skill.rate(95);
    expect(skill.toSnapshot().score).toBe(40);
  });
});

describe("decay (FR-S4)", () => {
  it("fades a score that has not been retrieved", () => {
    // "A skill you haven't touched in 6 months should visibly fade."
    const skill = withScore({ score: 80, lastEvidenceAt: NOW, halfLifeDays: 90 });

    expect(skill.currentScore(NOW)).toBe(80);
    expect(skill.currentScore(daysLater(90))).toBeCloseTo(40, 1);
  });

  it("moves the band without anything being written", () => {
    // The band is derived, not stored: a stored one would be a second copy of the score that goes
    // stale the day decay moves it, which is the whole point of FR-S4.
    const skill = withScore({ score: 80, lastEvidenceAt: NOW, halfLifeDays: 90 });

    expect(skill.currentBand(NOW)).toBe("fluent");
    expect(skill.currentBand(daysLater(90))).toBe("assisted");
  });

  it("becomes unproven again rather than reading as a tiny number", () => {
    const skill = withScore({ score: 80, lastEvidenceAt: NOW, halfLifeDays: 90 });
    expect(skill.currentScore(daysLater(5 * 365))).toBeNull();
  });

  it("fades faster with a shorter half-life", () => {
    const quick = withScore({ score: 80, lastEvidenceAt: NOW, halfLifeDays: 30 });
    const slow = withScore({ score: 80, lastEvidenceAt: NOW, halfLifeDays: 365 });

    expect(quick.currentScore(daysLater(60))!).toBeLessThan(slow.currentScore(daysLater(60))!);
  });

  it("refuses a half-life that would switch decay off", () => {
    // An effectively infinite half-life is a way to make the dashboard flatter without knowing more.
    const skill = created();
    expect(() => skill.edit({ halfLifeDays: 100_000 })).toThrow(RangeError);
    expect(() => skill.edit({ halfLifeDays: 1 })).toThrow(RangeError);
    expect(skill.halfLifeDays).toBe(90);
  });

  it("feathers the gauge by how stale the evidence is", () => {
    // Uncertainty rendered as soft edges rather than a ± footnote (§9.1).
    const skill = withScore({ score: 80, lastEvidenceAt: NOW });

    expect(skill.feather(NOW)).toBe("crisp");
    expect(skill.feather(daysLater(30))).toBe("soft");
    expect(skill.feather(daysLater(120))).toBe("vague");
  });

  it("is vague for a skill with no evidence at all", () => {
    expect(created().feather(NOW)).toBe("vague");
  });
});

describe("the calibration gap (FR-S5)", () => {
  it("compares a rating against the decayed score, not the stored one", () => {
    // Comparing against a year-stale figure would measure how long ago you learned something rather
    // than how well you know it now.
    const skill = withScore({
      score: 80,
      perceivedLevel: 80,
      lastEvidenceAt: NOW,
      halfLifeDays: 90,
    });

    expect(skill.calibration(NOW).verdict).toBe("calibrated");
    // Same rating, same stored score, three months later: the evidence has faded and the rating has not.
    expect(skill.calibration(daysLater(90)).verdict).toBe("overconfident");
  });

  it("reports no gap for a skill rated but never demonstrated", () => {
    // The most interesting row in the table, and calling it perfectly calibrated would hide it.
    const calibration = created(85).calibration(NOW);
    expect(calibration.gap).toBeNull();
    expect(calibration.missing).toBe("score");
  });

  it("reports no gap for a skill scored but never rated", () => {
    expect(withScore({ score: 60, lastEvidenceAt: NOW }).calibration(NOW).missing).toBe(
      "self_rating",
    );
  });
});

describe("rating", () => {
  it("takes a rating and lets it be retracted", () => {
    // Retracting a guess is different from rating yourself zero.
    const skill = created(70);
    expect(skill.perceivedLevel).toBe(70);

    skill.rate(null);
    expect(skill.perceivedLevel).toBeNull();
  });

  it("refuses a rating off the 0–100 scale", () => {
    const skill = created();
    expect(() => skill.rate(101)).toThrow(RangeError);
    expect(() => skill.rate(-1)).toThrow(RangeError);
    expect(skill.perceivedLevel).toBeNull();
  });

  it("accepts the ends of the scale", () => {
    const skill = created();
    skill.rate(0);
    expect(skill.perceivedLevel).toBe(0);
    skill.rate(100);
    expect(skill.perceivedLevel).toBe(100);
  });
});

describe("editing", () => {
  it("refuses to blank the name", () => {
    const skill = created();
    expect(() => skill.edit({ name: "  " })).toThrow(RangeError);
    expect(skill.name).toBe("Rust ownership");
  });

  it("clears a description when asked", () => {
    const skill = created();
    skill.edit({ description: "how borrowing works" });
    skill.edit({ description: null });
    expect(skill.description).toBeNull();
  });
});

describe("snapshots", () => {
  it("round-trips", () => {
    const snapshot: SkillSnapshot = {
      id: ID,
      userId: USER,
      name: "Rust ownership",
      slug: "rust-ownership",
      description: "how borrowing works",
      perceivedLevel: 70,
      score: 55.5,
      scoreStdDev: 12.25,
      halfLifeDays: 120,
      lastEvidenceAt: NOW,
      createdAt: NOW,
    };
    expect(Skill.fromSnapshot(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it("refuses a snapshot with an impossible rating", () => {
    // A hand-edited row, or a column written before the constraint existed. Better a loud failure than
    // a calibration gap computed from 900.
    expect(() => withScore({ perceivedLevel: 900 })).toThrow(RangeError);
  });
});
