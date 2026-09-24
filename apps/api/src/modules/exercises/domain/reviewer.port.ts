import type { ReviewCall, ReviewRequestInput } from "@mindforge/llm";

export const REVIEWER = Symbol("Reviewer");

/**
 * Where a whiteboard review comes from (FR-X8). A port for the same reasons the
 * hint generator is one: tests stub it (non-negotiable 8), and "no key" is the
 * adapter's refusal rather than an `if` in the use case.
 */
export interface Reviewer {
  /** Throws `ReviewsUnavailable` or `ReviewServiceBusy` when the call cannot be made or fails. */
  review(input: ReviewRequestInput): Promise<ReviewCall>;
}
