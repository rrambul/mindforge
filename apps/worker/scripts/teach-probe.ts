/**
 * The M3 spike, run by hand.
 *
 * NORTHSTAR sequencing rule 2 timeboxes the Agent SDK integration, and this is
 * the gate: four questions that cannot be answered by reading `sdk.d.ts`, only
 * by starting a real session. It is a script and not a test on purpose —
 * non-negotiable 8 forbids live API calls in the suite, and this makes one.
 *
 *   1. Does the composed plugin load? A bad path is skipped silently, so a run
 *      with no skill looks exactly like a run with one. (`init.plugins`)
 *   2. Is the skill invokable once its `disable-model-invocation` guard is
 *      stripped, or does something else still enforce it? (`init.skills`)
 *   3. Is `Bash` actually withheld, or merely un-auto-approved? (`init.tools`)
 *   4. What does a run report per assistant message, so `llm_calls` can be
 *      reconstructed — and is `request_id` populated? (`--teach`)
 *
 * Default mode sends a one-turn no-op and reads the init handshake, which costs
 * a fraction of a cent. `--teach` runs a real lesson against a throwaway
 * workspace and answers TECH-DESIGN §16.2 — what a run costs and how long it
 * takes. `--keep` leaves the temp directory behind to inspect.
 *
 *   pnpm --filter @mindforge/worker probe:teach
 *   pnpm --filter @mindforge/worker probe:teach -- --teach --keep
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { TEACH_SKILL_REF } from "@mindforge/workspace";

import { writeTeachPlugin } from "../src/modules/teach/infrastructure/teach-plugin.js";

const FULL_RUN = process.argv.includes("--teach");
const KEEP = process.argv.includes("--keep");

/**
 * **`CLAUDE_CONFIG_DIR` isolation also isolates the credentials.**
 *
 * Pointing the subprocess at a fresh config directory is what keeps one user's
 * run from reading the host's settings — and it is also where a Claude Code
 * login lives, so the run comes up `apiKeySource: "none"` and fails with
 * "Not logged in". In production that is correct and irrelevant: the worker
 * authenticates with `ANTHROPIC_API_KEY` (§11 — the key exists only in `api` and
 * `worker`), which is passed through `env` and needs no config directory.
 *
 * Locally there may be no API key, only a logged-in CLI. So: with a key, run the
 * production shape. Without one, fall back to the host's config directory and say
 * so — the handshake assertions still hold, and it is worth being loud that this
 * is a developer convenience production must not copy.
 */
const HAS_API_KEY = Boolean(process.env["ANTHROPIC_API_KEY"]);

/** Matches the production run. Kept here so the probe cannot drift from what ships. */
const TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"] as const;
const TIMEOUT_MS = FULL_RUN ? 15 * 60_000 : 90_000;

const MISSION = `# Mission

## Topic

Postgres row-level security, enough to review a migration and spot a policy that isolates nothing.

## Why

I write RLS policies for a single-user app and I want to stop trusting that they work.

## Success Looks Like

I can read a policy and say which role it binds to and what it lets through.

## Constraints

30 minutes. Text over video.

## Current Level

I write SQL comfortably. I have never debugged a policy that silently failed open.

## History

- 2026-08-08: Created for a probe run.
`;

const BRIEFING = `# Briefing

Generated for this run. Read it before anything else.

## ZPD candidates

From learning records' Next sections only — skill-graph gaps and due reviews are not yet available
as inputs.

- Nothing recorded yet. This is the first session on this mission.

## Due reviews

Not tracked yet — spaced repetition ships in a later release. Do not assume the learner has or has
not revised anything.

## Skill evidence

None recorded yet. Any levels stated above are self-reported, not measured.

## Recent friction

None recorded in the last 14 days.
`;

interface CallRow {
  readonly messageId: string;
  readonly requestId: string | undefined;
  readonly model: string;
  readonly usage: unknown;
}

const state = {
  calls: [] as CallRow[],
  sawSkillUse: false,
  failures: 0,
};

function heading(text: string): void {
  console.log(`\n${"─".repeat(72)}\n${text}\n${"─".repeat(72)}`);
}

function verdict(ok: boolean, claim: string): void {
  if (!ok) state.failures += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${claim}`);
}

async function seedWorkspace(
  dir: string,
  formatDocs: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "MISSION.md"), MISSION, "utf8");
  await writeFile(join(dir, "BRIEFING.md"), BRIEFING, "utf8");
  // Beside the mission as well as inside the plugin, so the skill's relative
  // links resolve from `cwd` too. These are on the sync-back exclude list.
  await Promise.all(
    Object.entries(formatDocs).map(([name, contents]) =>
      writeFile(join(dir, name), contents, "utf8"),
    ),
  );
}

function reportInit(message: Extract<SDKMessage, { type: "system"; subtype: "init" }>): void {
  heading("system/init — the three assertions the production run makes");

  const pluginNames = message.plugins.map((plugin) => plugin.name);

  console.log(`  cli        ${message.claude_code_version}`);
  console.log(`  model      ${message.model}`);
  console.log(`  auth       ${message.apiKeySource}`);
  console.log(`  mode       ${message.permissionMode}`);
  console.log(`  cwd        ${message.cwd}`);
  console.log(`  plugins    ${JSON.stringify(pluginNames)}`);
  console.log(`  skills     ${JSON.stringify(message.skills)}`);
  console.log(`  tools      ${JSON.stringify(message.tools)}`);
  console.log();

  verdict(pluginNames.includes("mindforge-teach"), "Q1  the composed plugin loaded");
  verdict(
    message.skills.includes(TEACH_SKILL_REF),
    `Q2  ${TEACH_SKILL_REF} is loaded and namespaced`,
  );
  verdict(
    !message.tools.includes("Bash"),
    "Q3  Bash is absent from the tool list, not merely un-approved",
  );
}

function reportResult(message: Extract<SDKMessage, { type: "result" }>): void {
  heading(`result — subtype: ${message.subtype}`);
  console.log(`  turns          ${message.num_turns}`);
  console.log(`  duration       ${(message.duration_ms / 1000).toFixed(1)}s`);
  console.log(`  SDK cost est.  $${message.total_cost_usd.toFixed(4)}`);
  console.log(`  usage          ${JSON.stringify(message.usage)}`);
  console.log(`  modelUsage     ${JSON.stringify(message.modelUsage, null, 2)}`);
  if (message.permission_denials.length > 0) {
    console.log(`  denials        ${JSON.stringify(message.permission_denials, null, 2)}`);
  }
  if (message.subtype !== "success") {
    console.log(`  errors         ${JSON.stringify(message.errors)}`);
    state.failures += 1;
  }

  heading("Q4  what llm_calls must be reconstructed from");
  const distinct = new Set(state.calls.map((call) => call.messageId));
  console.log(`  assistant messages   ${state.calls.length}`);
  console.log(`  distinct message ids ${distinct.size}   <- one llm_calls row each`);
  console.log(
    `  request_id present   ${state.calls.filter((call) => call.requestId).length}/${state.calls.length}`,
  );
  console.log();
  for (const call of state.calls) {
    console.log(
      `  ${call.messageId}  req=${call.requestId ?? "—"}  ${call.model}  ${JSON.stringify(call.usage)}`,
    );
  }

  // The reconciliation that turned out to matter. The message stream is not the
  // whole bill: the SDK makes model calls of its own that never surface as an
  // assistant message, and `usage` reports only the main model. `modelUsage` is
  // the authoritative whole-tree figure, so the gap between it and the sum of the
  // visible turns is real spend that per-message rows would silently drop.
  heading("Q4b  the gap between the visible turns and the actual bill");
  const seen = new Map<string, number>();
  for (const call of state.calls) {
    const usage = call.usage as { output_tokens?: number } | null;
    seen.set(call.model, (seen.get(call.model) ?? 0) + (usage?.output_tokens ?? 0));
  }
  console.log(`  models in modelUsage   ${Object.keys(message.modelUsage).join(", ") || "none"}`);
  console.log(`  models in the stream   ${[...seen.keys()].join(", ") || "none"}`);
  for (const [model, usage] of Object.entries(message.modelUsage)) {
    const visible = seen.get(model) ?? seen.get(usage.canonicalModel ?? model) ?? 0;
    const invisible = usage.outputTokens - visible;
    console.log(
      `  ${model}  canonical=${usage.canonicalModel ?? "—"}  out=${usage.outputTokens} ` +
        `(visible ${visible}, unattributed ${invisible})  $${usage.costUSD.toFixed(6)}`,
    );
    if (invisible > 0) {
      console.log(
        `    ^ ${invisible} output tokens on this model never appeared as an assistant message.`,
      );
    }
    if (usage.canonicalModel && usage.canonicalModel !== model) {
      console.log(
        `    ^ keyed by a dated id; packages/llm's PRICING has "${usage.canonicalModel}", so a ` +
          `lookup on the key throws. Canonicalise before pricing.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "mindforge-probe-"));
  const dir = join(root, "workspace");

  try {
    const plugin = await writeTeachPlugin(join(root, "plugin"));
    await seedWorkspace(dir, plugin.formatDocs);

    console.log(`workspace  ${dir}`);
    console.log(`plugin     ${plugin.path}`);
    console.log(`mode       ${FULL_RUN ? "full teach run" : "init handshake only"}`);
    console.log(
      `auth       ${HAS_API_KEY ? "ANTHROPIC_API_KEY, isolated config dir (production shape)" : "host ~/.claude login — DEV ONLY, production always uses the key"}`,
    );

    const ac = new AbortController();
    const deadline = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      for await (const message of query({
        prompt: FULL_RUN
          ? "Teach me the next thing. Read BRIEFING.md first — it has my current zone of " +
            "proximal development, weak skills, and what is not measured yet."
          : "Reply with the single word: ok",
        options: {
          cwd: dir,
          model: "claude-opus-5",
          effort: FULL_RUN ? "high" : "low",
          maxTurns: FULL_RUN ? 40 : 1,
          abortController: ac,
          tools: [...TOOLS],
          disallowedTools: ["Bash"],
          permissionMode: "dontAsk",
          allowedTools: [...TOOLS],
          plugins: [{ type: "local", path: plugin.path }],
          skills: [plugin.skillRef],
          settingSources: [],
          strictMcpConfig: true,
          env: HAS_API_KEY
            ? { ...process.env, CLAUDE_CONFIG_DIR: join(root, "claude-config") }
            : { ...process.env },
          stderr: () => {},
        },
      })) {
        if (message.type === "system" && message.subtype === "init") {
          reportInit(message);
          await writeFile(
            join(root, "init-message.json"),
            `${JSON.stringify(message, null, 2)}\n`,
            "utf8",
          );
        } else if (message.type === "assistant") {
          state.calls.push({
            messageId: message.message.id,
            requestId: message.request_id,
            model: message.message.model,
            usage: message.message.usage,
          });
          state.sawSkillUse ||= message.message.content.some(
            (block) => block.type === "tool_use" && block.name === "Skill",
          );
        } else if (message.type === "result") {
          reportResult(message);
        }
      }
    } catch (error) {
      // A failing run yields its result message and *then* throws (§7.3). Reaching
      // here after a terminal result is expected, not a surprise.
      console.log(`\n  query() threw: ${(error as Error).message}`);
    } finally {
      clearTimeout(deadline);
    }

    if (FULL_RUN) {
      heading("Verdicts — the full run");
      verdict(state.sawSkillUse, "the agent actually invoked the Skill tool");
      const lessons = await readdir(join(dir, "lessons")).catch(() => [] as string[]);
      verdict(lessons.length > 0, `a lesson file was written (${lessons.join(", ") || "none"})`);
      console.log(`\n  wall clock: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    }

    if (KEEP) console.log(`\nkept: ${root}`);
  } finally {
    if (!KEEP) await rm(root, { recursive: true, force: true });
  }
}

await main();
if (state.failures > 0) console.log(`\n${state.failures} assertion(s) failed.`);
process.exit(state.failures > 0 ? 1 : 0);
