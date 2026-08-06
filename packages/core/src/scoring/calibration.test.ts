import { describe, expect, it } from "vitest";
import { CALIBRATION_TOLERANCE, calibrationFor, overallCalibration } from "./calibration.js";

describe("calibrationFor", () => {
  it("reports overconfidence as a positive gap (FR-S5)", () => {
    // The metric the requirements call the highest-value thing the app can show: the fluency illusion
    // made arithmetic.
    const calibration = calibrationFor(80, 50);
    expect(calibration.gap).toBe(30);
    expect(calibration.verdict).toBe("overconfident");
  });

  it("reports underconfidence as a negative gap", () => {
    // Worth naming rather than folding into "miscalibrated": someone who knows more than they think
    // needs different advice — do the harder thing — from someone who knows less.
    const calibration = calibrationFor(40, 75);
    expect(calibration.gap).toBe(-35);
    expect(calibration.verdict).toBe("underconfident");
  });

  it("treats a small difference as calibrated", () => {
    // The score carries a confidence interval often wider than this, so a tighter band would report
    // noise as overconfidence — and a metric that cries wolf gets ignored, taking the signal with it.
    expect(calibrationFor(60, 55).verdict).toBe("calibrated");
    expect(calibrationFor(55, 60).verdict).toBe("calibrated");
  });

  it("puts the boundary exactly at the tolerance", () => {
    expect(calibrationFor(60 + CALIBRATION_TOLERANCE, 60).verdict).toBe("calibrated");
    expect(calibrationFor(60 + CALIBRATION_TOLERANCE + 1, 60).verdict).toBe("overconfident");
  });

  describe("when half the comparison is missing", () => {
    it("reports no gap for an unproven skill, rather than a gap of zero", () => {
      // A skill you rate highly and have never demonstrated is exactly what this metric exists to
      // surface. Calling it perfectly calibrated would hide the most interesting row in the table.
      const calibration = calibrationFor(80, null);
      expect(calibration.gap).toBeNull();
      expect(calibration.verdict).toBeNull();
      expect(calibration.missing).toBe("score");
    });

    it("reports no gap when you have not rated yourself", () => {
      const calibration = calibrationFor(null, 60);
      expect(calibration.gap).toBeNull();
      expect(calibration.missing).toBe("self_rating");
    });

    it("says when both are missing", () => {
      // So the UI can ask for the half it needs instead of showing a shrug.
      expect(calibrationFor(null, null).missing).toBe("both");
    });

    it("still names whichever band it does know", () => {
      // "You say Fluent; there is no evidence yet" is a useful sentence, and it needs the band.
      expect(calibrationFor(80, null).perceivedBand).toBe("fluent");
      expect(calibrationFor(80, null).demonstratedBand).toBeNull();
      expect(calibrationFor(null, 60).demonstratedBand).toBe("working");
    });
  });

  describe("bands", () => {
    it("counts the distance in bands, signed", () => {
      // The number people act on: "you think you're Fluent, the evidence says Assisted" lands harder
      // than "you are 40 points out".
      const calibration = calibrationFor(75, 30);
      expect(calibration.perceivedBand).toBe("fluent");
      expect(calibration.demonstratedBand).toBe("assisted");
      expect(calibration.bandGap).toBe(2);
    });

    it("is zero bands apart when both land in the same band", () => {
      // The points gap can be nonzero while the band gap is not, which is honest: 51 and 69 are both
      // Working, and the bands exist because that distinction rarely matters.
      const calibration = calibrationFor(69, 51);
      expect(calibration.bandGap).toBe(0);
      expect(calibration.gap).toBe(18);
    });

    it("goes negative when the evidence is ahead", () => {
      expect(calibrationFor(30, 75).bandGap).toBe(-2);
    });
  });

  it("handles the extremes without inventing a verdict", () => {
    expect(calibrationFor(100, 0).verdict).toBe("overconfident");
    expect(calibrationFor(0, 100).verdict).toBe("underconfident");
    expect(calibrationFor(0, 0).verdict).toBe("calibrated");
  });
});

describe("overallCalibration", () => {
  it("averages the gaps it has", () => {
    const result = overallCalibration([
      { perceivedLevel: 80, score: 50 },
      { perceivedLevel: 60, score: 50 },
    ]);
    expect(result.meanGap).toBe(20);
    expect(result.measured).toBe(2);
  });

  it("excludes unproven skills rather than counting them as zero", () => {
    // Otherwise every unscored skill would drag the mean toward "calibrated" — the app would look
    // better calibrated the less evidence it had, which is precisely backwards.
    const result = overallCalibration([
      { perceivedLevel: 80, score: 50 },
      { perceivedLevel: 90, score: null },
      { perceivedLevel: null, score: null },
    ]);

    expect(result.meanGap).toBe(30);
    expect(result.measured).toBe(1);
    expect(result.total).toBe(3);
  });

  it("says how many skills the mean is drawn from", () => {
    // A mean over three of forty is a fact about those three, and presenting it as "your calibration"
    // would be the same quiet overreach as a progress bar covering half a goal.
    const result = overallCalibration([
      { perceivedLevel: 80, score: 50 },
      ...Array.from({ length: 39 }, () => ({ perceivedLevel: 70, score: null })),
    ]);

    expect(result.measured).toBe(1);
    expect(result.total).toBe(40);
  });

  it("reports nothing rather than zero when nothing can be measured", () => {
    const result = overallCalibration([{ perceivedLevel: 90, score: null }]);
    expect(result.meanGap).toBeNull();
    expect(result.measured).toBe(0);
  });

  it("reports nothing for no skills at all", () => {
    expect(overallCalibration([]).meanGap).toBeNull();
  });
});
