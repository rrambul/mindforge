import type * as Llm from "@mindforge/llm";
import { ModelCallError } from "@mindforge/llm";
import { describe, expect, it, vi } from "vitest";

import { HintServiceBusy, HintsUnavailable } from "../domain/errors.js";
import { AnthropicHintGenerator } from "./anthropic-hint.generator.js";

/**
 * The adapter's one job beyond calling: turning a failed call into something the
 * learner can act on. "Not set up" and "try again" ask different things of them,
 * and the first live call this feature made — against a key with no credit — came
 * back as a generic 500 before this mapping existed.
 */

vi.mock("@mindforge/llm", async (original) => {
  const actual = await original<typeof Llm>();
  return { ...actual, requestHint: vi.fn() };
});

const { requestHint } = await import("@mindforge/llm");
const input = {} as Parameters<AnthropicHintGenerator["generate"]>[0];

describe("AnthropicHintGenerator", () => {
  it("refuses without calling anything when no key is configured", async () => {
    await expect(new AnthropicHintGenerator(null).generate(input)).rejects.toBeInstanceOf(
      HintsUnavailable,
    );
    expect(requestHint).not.toHaveBeenCalled();
  });

  it("calls a refused credential 'not available', which retrying will not fix", async () => {
    vi.mocked(requestHint).mockRejectedValueOnce(new ModelCallError("configuration", 400));

    await expect(new AnthropicHintGenerator("sk-test").generate(input)).rejects.toBeInstanceOf(
      HintsUnavailable,
    );
  });

  it("calls an overloaded service 'busy', which it may not be in a minute", async () => {
    vi.mocked(requestHint).mockRejectedValueOnce(new ModelCallError("transient", 529));

    await expect(new AnthropicHintGenerator("sk-test").generate(input)).rejects.toBeInstanceOf(
      HintServiceBusy,
    );
  });

  it("lets a bug of ours through as itself", async () => {
    const bug = new TypeError("ours");
    vi.mocked(requestHint).mockRejectedValueOnce(bug);

    await expect(new AnthropicHintGenerator("sk-test").generate(input)).rejects.toBe(bug);
  });
});
