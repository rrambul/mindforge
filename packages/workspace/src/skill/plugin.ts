/**
 * Composing the `teach` skill into something an unattended server run can
 * actually invoke.
 *
 * Three facts make this more than a file copy, all verified against
 * `@anthropic-ai/claude-agent-sdk@0.3.222` and written up in TECH-DESIGN.md §7.3:
 *
 * 1. **Copying `SKILL.md` into the workspace does not make it a skill.** Skill
 *    discovery walks `.claude/skills/` in `cwd` and its ancestors, and only when
 *    `settingSources` includes `'user'` or `'project'` — which also drags in the
 *    host machine's `~/.claude` and so is incompatible with running other
 *    people's missions. A plugin is the one mechanism that binds a skill
 *    directory to an arbitrary `cwd`.
 *
 * 2. **The upstream skill declares `disable-model-invocation: true`**, which
 *    means only a human typing a slash command may invoke it. The SDK has no
 *    slash-command surface, so left in place the skill loads, appears in
 *    `init.skills`, and can never be called — a run that looks completely normal
 *    and writes a lesson from parametric memory, which is the one thing
 *    `SKILL.md` forbids.
 *
 * 3. **The skill was written for a human sitting there.** `skills/UNATTENDED.md`
 *    is appended rather than merged into `SKILL.md`, so that
 *    `diff -r skills/teach ~/.claude/skills/teach` stays empty and §7.1's
 *    "the cloud agent and local /teach cannot drift" keeps being true.
 *
 * Everything here is a pure function of strings. The filesystem lives in
 * `apps/worker`, which is also the only place that can go wrong in a way a unit
 * test would not catch.
 */

/** Plugin directory name, and the namespace every skill inside it inherits. */
export const TEACH_PLUGIN_NAME = "mindforge-teach";

/**
 * How the skill must be named in `options.skills`. A bare `"teach"` matches
 * nothing once the skill is namespaced by its plugin, and `query()` throws at
 * construction rather than warning.
 */
export const TEACH_SKILL_REF = `${TEACH_PLUGIN_NAME}:teach`;

/** The frontmatter key that would leave the skill loaded and uninvokable. */
const MODEL_INVOCATION_GUARD = "disable-model-invocation";

const FRONTMATTER_FENCE = "---";

export class SkillCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillCompositionError";
  }
}

interface Frontmatter {
  readonly lines: readonly string[];
  readonly body: string;
}

/**
 * Split leading YAML frontmatter from the body.
 *
 * Deliberately strict: a skill file with no frontmatter has no `name`, so it is
 * not a skill at all and the plugin would load zero of them. Failing the build
 * is much cheaper than discovering that from a lesson that cites nothing.
 */
function splitFrontmatter(source: string): Frontmatter {
  const normalized = source.replace(/\r\n/gu, "\n");
  const lines = normalized.split("\n");

  if (lines[0]?.trim() !== FRONTMATTER_FENCE) {
    throw new SkillCompositionError(
      "SKILL.md has no YAML frontmatter, so it declares no skill name and would load nothing.",
    );
  }

  const closing = lines.indexOf(FRONTMATTER_FENCE, 1);
  if (closing === -1) {
    throw new SkillCompositionError("SKILL.md's YAML frontmatter is never closed.");
  }

  return {
    lines: lines.slice(1, closing),
    body: lines.slice(closing + 1).join("\n"),
  };
}

/** True when `line` sets `key`, allowing for the whitespace YAML allows. */
function declares(line: string, key: string): boolean {
  return new RegExp(`^\\s*${key}\\s*:`, "u").test(line);
}

/**
 * Remove the model-invocation guard, reporting whether it was there.
 *
 * The caller asserts on `stripped`: if upstream ever drops the key, this
 * quietly becomes a no-op, and a no-op that used to matter is exactly the kind
 * of thing that stops being checked.
 */
export function stripModelInvocationGuard(skillMd: string): {
  readonly text: string;
  readonly stripped: boolean;
} {
  const { lines, body } = splitFrontmatter(skillMd);
  const kept = lines.filter((line) => !declares(line, MODEL_INVOCATION_GUARD));

  if (kept.length === 0) {
    throw new SkillCompositionError(
      "SKILL.md's frontmatter would be empty once the guard is removed.",
    );
  }

  return {
    text: [FRONTMATTER_FENCE, ...kept, FRONTMATTER_FENCE, body].join("\n"),
    stripped: kept.length !== lines.length,
  };
}

/** The skill's declared `name:`, needed to check it still namespaces as expected. */
export function skillName(skillMd: string): string {
  const { lines } = splitFrontmatter(skillMd);
  const declaration = lines.find((line) => declares(line, "name"));
  const value = declaration
    ?.split(":")
    .slice(1)
    .join(":")
    .trim()
    .replace(/^["']|["']$/gu, "");

  if (!value) {
    throw new SkillCompositionError("SKILL.md's frontmatter declares no `name`.");
  }
  return value;
}

export interface TeachPluginSources {
  /** `skills/teach/SKILL.md`, verbatim from upstream. */
  readonly skill: string;
  /** `skills/UNATTENDED.md` — Mindforge's overrides for a run with no human. */
  readonly addendum: string;
  /** The three format docs, keyed by filename. Copied beside the skill so its relative links resolve. */
  readonly formatDocs: Readonly<Record<string, string>>;
}

export interface TeachPlugin {
  /** Relative path → contents. The caller writes these and nothing else. */
  readonly files: Readonly<Record<string, string>>;
  /** What `options.skills` must contain. */
  readonly skillRef: string;
}

/**
 * The plugin directory, as data.
 *
 * `.claude-plugin/plugin.json` is optional — the layout is auto-discovered — but
 * it is written anyway, because `init.plugins[].name` is what the run asserts on
 * and leaving the name to directory-basename inference makes that assertion
 * depend on where the directory happened to be created.
 */
export function buildTeachPlugin(sources: TeachPluginSources): TeachPlugin {
  const declared = skillName(sources.skill);
  if (`${TEACH_PLUGIN_NAME}:${declared}` !== TEACH_SKILL_REF) {
    throw new SkillCompositionError(
      `SKILL.md declares name "${declared}", so it would load as ` +
        `"${TEACH_PLUGIN_NAME}:${declared}" and not as "${TEACH_SKILL_REF}".`,
    );
  }

  const { text, stripped } = stripModelInvocationGuard(sources.skill);
  if (!stripped) {
    throw new SkillCompositionError(
      `Upstream SKILL.md no longer declares \`${MODEL_INVOCATION_GUARD}\`. That is good news, but ` +
        "this check exists so the removal is noticed rather than silently becoming a no-op — drop it here.",
    );
  }

  const files: Record<string, string> = {
    ".claude-plugin/plugin.json": `${JSON.stringify(
      {
        name: TEACH_PLUGIN_NAME,
        description: "The teach skill, composed for an unattended Mindforge run.",
        version: "1.0.0",
      },
      null,
      2,
    )}\n`,
    "skills/teach/SKILL.md": `${text.trimEnd()}\n\n${sources.addendum.trimStart()}`,
  };

  for (const [name, contents] of Object.entries(sources.formatDocs)) {
    files[`skills/teach/${name}`] = contents;
  }

  return { files, skillRef: TEACH_SKILL_REF };
}
