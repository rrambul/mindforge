import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useRunner } from "./use-runner.js";

/**
 * The guard behind the Run button (review #5): a run asked for while the runner is
 * not ready is not a run. It used to resolve as a fake `error`, which the caller
 * then recorded as an attempt the learner never made.
 */
describe("useRunner", () => {
  it("resolves to nothing, not to a fake error, when the runner is not ready", async () => {
    const { result } = renderHook(() => useRunner());

    await expect(
      result.current.run({ language: "javascript", code: "", tests: "" }),
    ).resolves.toBeNull();
  });
});
