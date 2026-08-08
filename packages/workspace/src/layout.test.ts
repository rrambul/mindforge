import { describe, expect, it } from "vitest";

import {
  deslugify,
  isConflictCopy,
  isExcludedFromSync,
  memoryPrefix,
  parseNumberedFilename,
  slugify,
  workspacePrefix,
} from "./layout.js";

describe("Storage prefixes", () => {
  it("scopes a workspace by user and then by mission key", () => {
    // §7.2's layout, literally. The path is what makes `mindforge pull` a future
    // afternoon rather than a protocol, and what makes the Storage policy a
    // prefix match on the user id.
    expect(workspacePrefix("u-1", "rust")).toBe("workspaces/u-1/rust");
    expect(memoryPrefix("u-1")).toBe("memory/u-1");
  });

  it("scopes memory by user only, because it spans every mission", () => {
    // §7.6: NOTES.md is per workspace and cannot tell a Rust mission what a
    // Portuguese one learned about how this person likes to be taught.
    expect(memoryPrefix("u-1")).not.toContain("workspaces");
  });
});

describe("isExcludedFromSync", () => {
  it("excludes the briefing, which is regenerated every run", () => {
    expect(isExcludedFromSync("BRIEFING.md")).toBe(true);
  });

  it("excludes the skill and its format docs, which are ours and not the learner's", () => {
    // Copied into the workspace so the skill's relative links resolve. Uploaded,
    // they would put Mindforge's scaffolding inside the user's Storage prefix and
    // give it workspace_files rows.
    for (const file of [
      "SKILL.md",
      "MISSION-FORMAT.md",
      "RESOURCES-FORMAT.md",
      "LEARNING-RECORD-FORMAT.md",
    ]) {
      expect(isExcludedFromSync(file)).toBe(true);
    }
  });

  it("excludes a whole directory by prefix, not just its exact name", () => {
    expect(isExcludedFromSync(".memory/background.md")).toBe(true);
    expect(isExcludedFromSync(".claude/settings.json")).toBe(true);
  });

  it("does not exclude the learner's own files", () => {
    for (const file of ["MISSION.md", "RESOURCES.md", "NOTES.md", "lessons/0001-x.html"]) {
      expect(isExcludedFromSync(file)).toBe(false);
    }
  });

  it("does not exclude a file that merely starts with an excluded name", () => {
    // `BRIEFING.md.bak` is the learner's; `.memoryfoo/` is not `.memory/`.
    expect(isExcludedFromSync("BRIEFING.md.bak")).toBe(false);
    expect(isExcludedFromSync(".memoryfoo/x.md")).toBe(false);
  });

  it("normalises a leading ./ and Windows separators", () => {
    expect(isExcludedFromSync("./BRIEFING.md")).toBe(true);
    expect(isExcludedFromSync(".memory\\background.md")).toBe(true);
  });
});

describe("isConflictCopy", () => {
  it("recognises a retained conflict copy", () => {
    // These live in Storage forever (non-negotiable 6) and must never be indexed:
    // one landing in lessons/ parses to a sequence that already exists and would
    // collide on unique (mission_id, seq).
    expect(isConflictCopy("lessons/0007-x.html.conflict-2026-08-08T12-00-00-000Z")).toBe(true);
    expect(isConflictCopy("lessons/0007-x.html")).toBe(false);
  });
});

describe("parseNumberedFilename", () => {
  it("splits the sequence from the slug", () => {
    expect(parseNumberedFilename("0007-closures-and-capture.html")).toMatchObject({
      seq: 7,
      slug: "closures-and-capture",
      filename: "0007-closures-and-capture.html",
    });
  });

  it("reports a null sequence for an unnumbered file", () => {
    expect(parseNumberedFilename("ownership.html").seq).toBeNull();
  });

  it("keeps the raw filename beside the normalised slug", () => {
    // The slug is derived and lossy; the filename is not. A workspace can
    // legitimately hold `0003-café-com-leite.html` — the agent writes in the
    // learner's content language (FR-L3) — and rebuilding a Storage path from the
    // normalised slug points at a file that does not exist.
    const parsed = parseNumberedFilename("0003-café-com-leite.html");

    expect(parsed.slug).toBe("cafe-com-leite");
    expect(parsed.filename).toBe("0003-café-com-leite.html");
  });

  it("handles a filename with spaces", () => {
    expect(parseNumberedFilename("0004-Weekly Review.md")).toMatchObject({
      seq: 4,
      slug: "weekly-review",
    });
  });

  it("never returns an empty slug", () => {
    expect(parseNumberedFilename("0005-.md").slug).toBe("0005");
    expect(parseNumberedFilename("---.md").slug).toBe("untitled");
  });
});

describe("slugify and deslugify", () => {
  it("strips accents rather than dropping the characters", () => {
    expect(slugify("Café com Leite")).toBe("cafe-com-leite");
  });

  it("turns a slug back into something a title column can hold", () => {
    expect(deslugify("closures-and-capture")).toBe("Closures And Capture");
    expect(deslugify("")).toBe("Untitled");
  });
});
