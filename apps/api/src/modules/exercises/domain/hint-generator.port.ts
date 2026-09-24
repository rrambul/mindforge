import type { HintCall, HintRequestInput } from "@mindforge/llm";

export const HINT_GENERATOR = Symbol("HintGenerator");

/**
 * Where a hint comes from. A port so the use case can be tested without a live
 * call (non-negotiable 8), and so "no API key configured" is the adapter's
 * problem rather than an `if` in the application layer.
 */
export interface HintGenerator {
  /** Throws `HintsUnavailable` when nothing can be asked. */
  generate(input: HintRequestInput): Promise<HintCall>;
}
