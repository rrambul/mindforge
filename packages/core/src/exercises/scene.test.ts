import { describe, expect, it } from "vitest";

import type { SceneElement } from "../schemas/exercise.js";
import { describeScene, SCENE_DESCRIPTION_MAX } from "./scene.js";

const box = (id: string, type = "rectangle"): SceneElement => ({ id, type });
const label = (id: string, containerId: string, text: string): SceneElement => ({
  id,
  type: "text",
  containerId,
  text,
});
const arrow = (
  id: string,
  from: string | null,
  to: string | null,
  type = "arrow",
): SceneElement => ({
  id,
  type,
  startBinding: from === null ? null : { elementId: from },
  endBinding: to === null ? null : { elementId: to },
});

describe("describeScene", () => {
  it("names each shape by its label and each arrow by what it joins", () => {
    const text = describeScene([
      box("api"),
      label("t1", "api", "API\n gateway"),
      box("q", "ellipse"),
      label("t2", "q", "Queue"),
      arrow("a1", "api", "q"),
      label("t3", "a1", "enqueue"),
    ]);

    expect(text).toContain("- rectangle: API gateway");
    expect(text).toContain("- ellipse: Queue");
    expect(text).toContain('- API gateway → Queue (labelled "enqueue")');
  });

  it("says when a shape has no label, and when an arrow is loose at one end", () => {
    const text = describeScene([
      box("db", "diamond"),
      arrow("a", "db", null),
      arrow("l", null, null, "line"),
    ]);

    expect(text).toContain("- diamond: (no label)");
    expect(text).toContain("- an unlabelled diamond → (nothing)");
    expect(text).toContain("- a free-standing line");
  });

  it("keeps free-standing notes, and counts freehand it cannot read", () => {
    const text = describeScene([
      { id: "n", type: "text", text: "writes are idempotent" },
      { id: "f1", type: "freedraw" },
      { id: "f2", type: "freedraw" },
    ]);

    expect(text).toContain('- "writes are idempotent"');
    expect(text).toContain("Freehand strokes: 2");
  });

  it("ignores deleted elements and arrows bound to them", () => {
    const text = describeScene([
      { ...box("gone"), isDeleted: true },
      box("kept"),
      arrow("a", "gone", "kept"),
    ]);

    expect(text).not.toContain("gone");
    expect(text).toContain("- (nothing) → an unlabelled rectangle");
  });

  it("says 'none' for an empty canvas rather than nothing at all", () => {
    expect(describeScene([])).toBe("Shapes: none.\n\nConnections: none.\n\nNotes: none.");
  });

  it("cuts a scene too large to review, and says it did", () => {
    const many = Array.from({ length: 400 }, (_, i) => [
      box(`b${i}`),
      label(`t${i}`, `b${i}`, "x".repeat(60)),
    ]).flat();
    const text = describeScene(many);

    expect(text.length).toBeLessThan(SCENE_DESCRIPTION_MAX + 100);
    expect(text).toMatch(/cut: the scene is larger/u);
  });
});
