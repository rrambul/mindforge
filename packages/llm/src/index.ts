/**
 * Model selection and request defaults.
 *
 * No module calls the Anthropic SDK directly — everything routes through this
 * package, which is what makes cost tracking, cache strategy, and model swaps
 * a one-file change. See TECH-DESIGN.md §8.
 */

export const MODELS = {
  /** Lesson generation, assessments, grading. The hardest, highest-value work. */
  reasoning: "claude-opus-5",
  /** Study plans: structured work over known inputs. */
  structured: "claude-sonnet-5",
  /** URL metadata, summarisation. High volume, low judgement. */
  cheap: "claude-haiku-4-5",
} as const;

export type ModelName = (typeof MODELS)[keyof typeof MODELS];

/**
 * Effort is the primary cost lever on Opus 5 — `low` and `medium` are unusually
 * capable there, so these are starting points to sweep against real output,
 * not settled values.
 */
export const EFFORT = {
  lessonGeneration: "high",
  assessmentGeneration: "high",
  grading: "medium",
  planGeneration: "medium",
  metadata: "low",
} as const;

/**
 * Anything above this must stream, or the SDK hits an HTTP timeout.
 * Note `max_tokens` caps thinking *plus* response text on Opus 5, where
 * thinking is on by default — size with headroom.
 */
export const STREAM_THRESHOLD_TOKENS = 16_000;

/** Minimum cacheable prefix on Opus 5. Shorter prefixes silently do not cache. */
export const CACHE_MIN_TOKENS = 512;

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** USD per million tokens. Update alongside any model change. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * Cache reads bill at ~0.1x and writes at ~1.25x (5-minute TTL). Tracking this
 * per call is what makes the cost meter honest — see TECH-DESIGN.md §8.6.
 */
export function estimateCostUsd(model: string, usage: LlmUsage): number {
  const rate = PRICING[model];
  if (!rate) throw new Error(`No pricing configured for model "${model}"`);
  const inputCost =
    ((usage.inputTokens + usage.cacheWriteTokens * 1.25 + usage.cacheReadTokens * 0.1) / 1e6) *
    rate.input;
  const outputCost = (usage.outputTokens / 1e6) * rate.output;
  return Number((inputCost + outputCost).toFixed(6));
}
