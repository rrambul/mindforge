import { describe, expect, it } from "vitest";
import { CACHE_MIN_TOKENS, MODELS, STREAM_THRESHOLD_TOKENS, estimateCostUsd } from "./index.js";

describe("estimateCostUsd", () => {
  const none = { cacheReadTokens: 0, cacheWriteTokens: 0 };

  it("prices plain input and output at the model's rate", () => {
    // 1M input @ $5 + 1M output @ $25 on Opus 5.
    const cost = estimateCostUsd(MODELS.reasoning, {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      ...none,
    });
    expect(cost).toBeCloseTo(30, 6);
  });

  it("charges cache reads at roughly a tenth of input", () => {
    const cached = estimateCostUsd(MODELS.reasoning, {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    expect(cached).toBeCloseTo(0.5, 6);
  });

  it("charges cache writes at a premium over plain input", () => {
    const written = estimateCostUsd(MODELS.reasoning, {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
    });
    expect(written).toBeCloseTo(6.25, 6);
  });

  it("makes caching cheaper than not caching across repeated calls", () => {
    // The whole reason the cache strategy exists: one write plus N reads must
    // beat N full-price prefixes. If this inverts, §8.4 is wrong.
    const prefix = 100_000;
    const uncached = 5 * estimateCostUsd(MODELS.reasoning, { inputTokens: prefix, outputTokens: 0, ...none });
    const cached =
      estimateCostUsd(MODELS.reasoning, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: prefix,
      }) +
      4 *
        estimateCostUsd(MODELS.reasoning, {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: prefix,
          cacheWriteTokens: 0,
        });
    expect(cached).toBeLessThan(uncached);
  });

  it("prices the cheap model below the reasoning model for identical usage", () => {
    const usage = { inputTokens: 500_000, outputTokens: 100_000, ...none };
    expect(estimateCostUsd(MODELS.cheap, usage)).toBeLessThan(
      estimateCostUsd(MODELS.reasoning, usage),
    );
  });

  it("throws on an unconfigured model instead of reporting zero cost", () => {
    // Silently costing $0 would hide spend, which defeats the point of the meter.
    expect(() => estimateCostUsd("claude-imaginary-9", { inputTokens: 1, outputTokens: 1, ...none }))
      .toThrow(/No pricing configured/);
  });
});

describe("request thresholds", () => {
  it("streams above the SDK's timeout-safe ceiling", () => {
    expect(STREAM_THRESHOLD_TOKENS).toBe(16_000);
  });

  it("knows Opus 5's minimum cacheable prefix", () => {
    expect(CACHE_MIN_TOKENS).toBe(512);
  });
});
