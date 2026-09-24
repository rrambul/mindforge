import { describe, expect, it } from "vitest";

import { openingPrompt, wasInvoked } from "./opening-prompt.js";

describe("openingPrompt", () => {
  it("still points at the briefing first", () => {
    expect(openingPrompt(["mindforge-teach:teach"])).toMatch(
      /^Teach me the next thing\. Read BRIEFING\.md first/u,
    );
  });

  it("names the main skill to invoke before writing anything", () => {
    expect(openingPrompt(["mindforge-curriculum:curriculum"])).toContain(
      "Invoke the `mindforge-curriculum:curriculum` skill before writing anything",
    );
  });

  it("says nothing of companions when there are none", () => {
    expect(openingPrompt(["mindforge-curriculum:curriculum"])).not.toContain("last step");
  });

  it("names a companion as the main skill's last step", () => {
    expect(openingPrompt(["mindforge-teach:teach", "mindforge-teach:humanizer"])).toContain(
      "Its last step names `mindforge-teach:humanizer` — invoke it as that step says",
    );
  });

  it("names several companions together", () => {
    expect(openingPrompt(["a:main", "a:one", "a:two"])).toContain(
      "names `a:one` and `a:two` — invoke them",
    );
  });

  it("is only the briefing line when no skill is given", () => {
    expect(openingPrompt([])).not.toContain("Invoke");
  });
});

describe("wasInvoked", () => {
  it("matches the namespaced name", () => {
    expect(wasInvoked("mindforge-teach:teach", new Set(["mindforge-teach:teach"]))).toBe(true);
  });

  it("matches the bare name the Skill tool also resolves", () => {
    expect(wasInvoked("mindforge-teach:humanizer", new Set(["humanizer"]))).toBe(true);
  });

  it("does not match a different skill", () => {
    expect(wasInvoked("mindforge-teach:humanizer", new Set(["mindforge-teach:teach"]))).toBe(false);
  });
});
