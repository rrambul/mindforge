import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Whiteboard, WHITEBOARD_ASSET_PATH } from "./Whiteboard.js";

/**
 * The canvas wrapper. The feature tests stub the canvas; these hold the two things
 * only the real module can show — that its fonts come from this origin, and that it
 * loads at all.
 */
describe("Whiteboard", () => {
  it("points the canvas at this origin's fonts before the canvas module loads", async () => {
    delete window.EXCALIDRAW_ASSET_PATH;
    render(<Whiteboard initialElements={[]} label="Board" />);

    // Set in the lazy loader: by the time the library can read it, it is ours, and
    // it never falls through to its CDN default.
    expect(window.EXCALIDRAW_ASSET_PATH).toBe(WHITEBOARD_ASSET_PATH);
    expect(await screen.findByRole("group", { name: "Board" })).toBeInTheDocument();
  });

  it("imports the real canvas implementation", async () => {
    // The library feature-detects a 2D context at import time, and jsdom has none.
    // A bare object is enough to answer the detection; nothing here draws.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    const module = await import("./whiteboard-impl.js");

    expect(typeof module.default).toBe("function");
  }, 30_000);
});
