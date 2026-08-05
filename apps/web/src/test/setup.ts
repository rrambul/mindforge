import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw.js";

/**
 * `onUnhandledRequest: "error"` is the load-bearing setting.
 *
 * A request the handlers do not cover would otherwise fall through to a real fetch,
 * which in jsdom fails asynchronously and surfaces as an unrelated assertion timing out.
 * Failing loudly at the request means a test that hits an endpoint nobody stubbed says
 * so, with the URL.
 */
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  // Explicit because `globals: false` means Testing Library cannot register its own
  // afterEach. Without it every test renders into the previous test's DOM, and the
  // symptom is "found multiple elements" in whichever test happens to run second.
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
