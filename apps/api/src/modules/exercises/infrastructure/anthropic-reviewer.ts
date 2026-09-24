import {
  createReviewClient,
  ModelCallError,
  requestReview,
  type HintClient,
  type ReviewCall,
  type ReviewRequestInput,
} from "@mindforge/llm";
import { Inject, Injectable } from "@nestjs/common";

import { ReviewServiceBusy, ReviewsUnavailable } from "../domain/errors.js";
import type { Reviewer } from "../domain/reviewer.port.js";
import { HINT_API_KEY } from "./anthropic-hint.generator.js";

/**
 * Whiteboard reviews from the Messages API, on the same explicit key as hints —
 * and for the same reason: the SDK's credential chain would find a developer's
 * `ant` profile and bill that instead.
 */
@Injectable()
export class AnthropicReviewer implements Reviewer {
  private readonly client: HintClient | null;

  constructor(@Inject(HINT_API_KEY) apiKey: string | null) {
    // Its own client: a review needs a longer timeout than a hint, and no retry.
    this.client = apiKey === null ? null : createReviewClient(apiKey);
  }

  async review(input: ReviewRequestInput): Promise<ReviewCall> {
    if (this.client === null) throw new ReviewsUnavailable();

    try {
      return await requestReview(this.client, input);
    } catch (error) {
      if (error instanceof ModelCallError) {
        throw error.reason === "configuration"
          ? new ReviewsUnavailable(error)
          : new ReviewServiceBusy(error);
      }
      throw error;
    }
  }
}
