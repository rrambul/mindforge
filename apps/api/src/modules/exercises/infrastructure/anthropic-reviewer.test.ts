import type * as Llm from "@mindforge/llm";
import { ModelCallError } from "@mindforge/llm";
import { describe, expect, it, vi } from "vitest";

import { ReviewServiceBusy, ReviewsUnavailable } from "../domain/errors.js";
import { AnthropicReviewer } from "./anthropic-reviewer.js";

/** The same mapping the hint adapter makes, for the same reason: "not set up" and "try again" differ. */

vi.mock("@mindforge/llm", async (original) => {
  const actual = await original<typeof Llm>();
  return { ...actual, requestReview: vi.fn() };
});

const { requestReview } = await import("@mindforge/llm");
const input = {} as Parameters<AnthropicReviewer["review"]>[0];

describe("AnthropicReviewer", () => {
  it("refuses without calling anything when no key is configured", async () => {
    await expect(new AnthropicReviewer(null).review(input)).rejects.toBeInstanceOf(
      ReviewsUnavailable,
    );
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("maps a refused credential to 'not available' and an overload to 'busy'", async () => {
    vi.mocked(requestReview).mockRejectedValueOnce(new ModelCallError("configuration", 400));
    await expect(new AnthropicReviewer("sk").review(input)).rejects.toBeInstanceOf(
      ReviewsUnavailable,
    );

    vi.mocked(requestReview).mockRejectedValueOnce(new ModelCallError("transient", 529));
    await expect(new AnthropicReviewer("sk").review(input)).rejects.toBeInstanceOf(
      ReviewServiceBusy,
    );
  });

  it("lets a bug of ours through as itself", async () => {
    const bug = new TypeError("ours");
    vi.mocked(requestReview).mockRejectedValueOnce(bug);

    await expect(new AnthropicReviewer("sk").review(input)).rejects.toBe(bug);
  });
});
