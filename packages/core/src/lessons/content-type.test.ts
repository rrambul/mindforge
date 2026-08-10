import { describe, expect, it } from "vitest";

import { contentTypeFor } from "./content-type.js";

describe("contentTypeFor", () => {
  it("serves a lesson as HTML, which is what makes it render at all", () => {
    expect(contentTypeFor("lessons/0007-closures.html")).toBe("text/html; charset=utf-8");
  });

  it("ignores the case of the extension", () => {
    expect(contentTypeFor("assets/DIAGRAM.PNG")).toBe("image/png");
  });

  it("reads the last extension, not the first", () => {
    expect(contentTypeFor("lessons/0007.draft.html")).toBe("text/html; charset=utf-8");
  });

  it("falls back to bytes for anything the workspace should not contain", () => {
    expect(contentTypeFor("assets/notes.zip")).toBe("application/octet-stream");
    expect(contentTypeFor("LICENSE")).toBe("application/octet-stream");
  });
});
