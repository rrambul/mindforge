import { describe, expect, it } from "vitest";

import {
  buildTeachPlugin,
  SkillCompositionError,
  skillName,
  stripModelInvocationGuard,
  TEACH_SKILL_REF,
} from "./plugin.js";

const UPSTREAM = [
  "---",
  "name: teach",
  "description: Teach the user a new skill or concept, within this workspace.",
  "disable-model-invocation: true",
  'argument-hint: "What would you like to learn about?"',
  "---",
  "",
  "The user has asked you to teach them something.",
  "",
].join("\n");

const ADDENDUM = "# Running inside Mindforge\n\nNobody is there.\n";

const SOURCES = {
  skill: UPSTREAM,
  addendum: ADDENDUM,
  formatDocs: { "MISSION-FORMAT.md": "# MISSION.md Format\n" },
};

describe("stripModelInvocationGuard", () => {
  it("removes the guard and reports that it did", () => {
    const { text, stripped } = stripModelInvocationGuard(UPSTREAM);

    expect(stripped).toBe(true);
    expect(text).not.toContain("disable-model-invocation");
  });

  it("keeps every other frontmatter key and the body", () => {
    const { text } = stripModelInvocationGuard(UPSTREAM);

    expect(text).toContain("name: teach");
    expect(text).toContain('argument-hint: "What would you like to learn about?"');
    expect(text).toContain("The user has asked you to teach them something.");
  });

  it("still parses when the guard is written with YAML's permitted whitespace", () => {
    const spaced = UPSTREAM.replace(
      "disable-model-invocation: true",
      "  disable-model-invocation : true",
    );

    expect(stripModelInvocationGuard(spaced).stripped).toBe(true);
  });

  it("leaves a file that never declared the guard untouched, and says so", () => {
    const without = UPSTREAM.replace("disable-model-invocation: true\n", "");
    const { text, stripped } = stripModelInvocationGuard(without);

    expect(stripped).toBe(false);
    expect(text).toContain("name: teach");
  });

  it("refuses a file with no frontmatter rather than shipping a plugin with no skill", () => {
    expect(() => stripModelInvocationGuard("# teach\n\nbody\n")).toThrow(SkillCompositionError);
  });

  it("refuses frontmatter that is never closed", () => {
    expect(() => stripModelInvocationGuard("---\nname: teach\n\nbody\n")).toThrow(/never closed/u);
  });

  it("refuses frontmatter that is nothing but the guard, which would strip to an empty block", () => {
    expect(() =>
      stripModelInvocationGuard("---\ndisable-model-invocation: true\n---\n\nbody\n"),
    ).toThrow(/would be empty/u);
  });

  it("normalises CRLF, so a checkout with Windows line endings composes the same plugin", () => {
    const crlf = UPSTREAM.replace(/\n/gu, "\r\n");

    expect(stripModelInvocationGuard(crlf).text).toBe(stripModelInvocationGuard(UPSTREAM).text);
  });
});

describe("skillName", () => {
  it("reads the declared name", () => {
    expect(skillName(UPSTREAM)).toBe("teach");
  });

  it("unwraps a quoted name", () => {
    expect(skillName(UPSTREAM.replace("name: teach", 'name: "teach"'))).toBe("teach");
  });

  it("throws when no name is declared, since a nameless skill loads as nothing", () => {
    expect(() => skillName(UPSTREAM.replace("name: teach\n", ""))).toThrow(/declares no `name`/u);
  });
});

describe("buildTeachPlugin", () => {
  it("writes the manifest, the skill, and every format doc beside it", () => {
    const { files } = buildTeachPlugin(SOURCES);

    expect(Object.keys(files).sort()).toEqual([
      ".claude-plugin/plugin.json",
      "skills/teach/MISSION-FORMAT.md",
      "skills/teach/SKILL.md",
    ]);
  });

  it("names the plugin explicitly rather than letting it be inferred from the directory", () => {
    const { files } = buildTeachPlugin(SOURCES);

    expect(JSON.parse(files[".claude-plugin/plugin.json"]!)).toMatchObject({
      name: "mindforge-teach",
    });
  });

  it("appends the addendum after the upstream body, not into the frontmatter", () => {
    const composed = buildTeachPlugin(SOURCES).files["skills/teach/SKILL.md"]!;
    const [, frontmatter] = composed.split("---");

    expect(frontmatter).not.toContain("Running inside Mindforge");
    expect(composed.indexOf("Running inside Mindforge")).toBeGreaterThan(
      composed.indexOf("The user has asked you to teach them something."),
    );
  });

  it("reports the namespaced reference the run must pass to options.skills", () => {
    expect(buildTeachPlugin(SOURCES).skillRef).toBe("mindforge-teach:teach");
    expect(TEACH_SKILL_REF).toBe("mindforge-teach:teach");
  });

  it("fails loudly once upstream drops the guard, rather than becoming a silent no-op", () => {
    const patched = UPSTREAM.replace("disable-model-invocation: true\n", "");

    expect(() => buildTeachPlugin({ ...SOURCES, skill: patched })).toThrow(/no longer declares/u);
  });

  it("fails when a rename upstream would change how the skill must be referenced", () => {
    const renamed = UPSTREAM.replace("name: teach", "name: tutor");

    expect(() => buildTeachPlugin({ ...SOURCES, skill: renamed })).toThrow(
      /mindforge-teach:tutor/u,
    );
  });
});
