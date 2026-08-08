import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TEACH_SKILL_REF } from "@mindforge/workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeTeachPlugin } from "../src/modules/teach/infrastructure/teach-plugin.js";

/**
 * The plugin directory the agent is actually pointed at.
 *
 * `packages/workspace` tests the composition as a function of strings. This tests
 * the half that can only be wrong on disk, and it is the half where being wrong
 * is silent: **the SDK skips a nonexistent plugin path without a word.** No
 * throw, no warning — the session runs with no skill and writes a plausible
 * lesson from parametric memory, which is the one thing `SKILL.md` forbids.
 *
 * So this asserts the files exist where the SDK will look for them, against the
 * vendored `skills/` in the real repo rather than a fixture. A rename or a moved
 * directory fails here rather than at the first run.
 */

let destination: string;

beforeEach(async () => {
  destination = await mkdtemp(join(tmpdir(), "mindforge-plugin-test-"));
});

afterEach(async () => {
  await rm(destination, { recursive: true, force: true });
});

describe("writeTeachPlugin", () => {
  it("writes a plugin layout the SDK can discover", async () => {
    const plugin = await writeTeachPlugin(destination);

    expect(plugin.path).toBe(destination);
    await expect(
      readFile(join(destination, ".claude-plugin/plugin.json"), "utf8"),
    ).resolves.toContain("mindforge-teach");
    await expect(readFile(join(destination, "skills/teach/SKILL.md"), "utf8")).resolves.toContain(
      "name: teach",
    );
  });

  it("finds the vendored skill from the repo, wherever the worker is run from", async () => {
    // The path is resolved from this file's own location rather than from cwd,
    // because the worker is started by turbo from the repo root, by node from
    // apps/worker, and by a container from /app.
    const plugin = await writeTeachPlugin(destination);

    expect(Object.keys(plugin.formatDocs).sort()).toEqual([
      "LEARNING-RECORD-FORMAT.md",
      "MISSION-FORMAT.md",
      "RESOURCES-FORMAT.md",
    ]);
  });

  it("strips the guard that would leave the skill loaded and uninvokable", async () => {
    // Upstream declares `disable-model-invocation: true`, which means only a human
    // typing a slash command may call it — and the SDK has no slash commands. Left
    // in, the skill appears in init.skills and can never run.
    await writeTeachPlugin(destination);
    const composed = await readFile(join(destination, "skills/teach/SKILL.md"), "utf8");

    expect(composed).not.toContain("disable-model-invocation");
    // And upstream still declares it, which is what makes the strip meaningful
    // rather than a no-op nobody would notice becoming one.
    const upstream = await readFile(
      new URL("../../../skills/teach/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(upstream).toContain("disable-model-invocation: true");
  });

  it("appends the unattended addendum after the upstream body", async () => {
    await writeTeachPlugin(destination);
    const composed = await readFile(join(destination, "skills/teach/SKILL.md"), "utf8");

    expect(composed).toContain("Running inside Mindforge");
    expect(composed.indexOf("Running inside Mindforge")).toBeGreaterThan(
      composed.indexOf("Teaching Workspace"),
    );
  });

  it("copies the format docs beside the skill so its relative links resolve", async () => {
    // SKILL.md links `[MISSION-FORMAT.md](./MISSION-FORMAT.md)`. Without these the
    // agent reads a broken link and works from memory of the format instead.
    await writeTeachPlugin(destination);

    await expect(
      readFile(join(destination, "skills/teach/MISSION-FORMAT.md"), "utf8"),
    ).resolves.toContain("## Topic");
  });

  it("reports the namespaced reference the run must pass to options.skills", async () => {
    // A bare "teach" matches nothing once the skill is namespaced by its plugin,
    // and query() throws at construction rather than warning.
    const plugin = await writeTeachPlugin(destination);

    expect(plugin.skillRef).toBe(TEACH_SKILL_REF);
  });

  it("is idempotent, so a retried run does not half-write a plugin", async () => {
    await writeTeachPlugin(destination);
    const first = await readFile(join(destination, "skills/teach/SKILL.md"), "utf8");
    await writeTeachPlugin(destination);
    const second = await readFile(join(destination, "skills/teach/SKILL.md"), "utf8");

    expect(second).toBe(first);
  });
});
