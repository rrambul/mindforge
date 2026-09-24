import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw.js";

/**
 * jsdom has no layout, and CodeMirror measures text ranges: `Range.getClientRects`
 * is missing, and a real editor mounted in a test throws from its measure loop — on
 * CI's timing, not always locally (seen on `main`, 2026-09-24). Empty rectangles are
 * the honest stand-in: nothing in these tests asserts on where text is drawn.
 */
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  const empty = Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = () => empty;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

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
