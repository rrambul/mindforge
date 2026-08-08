import { TeachRuns, type AgentRunResult } from "@mindforge/api/teach";
import { estimateCostUsd, type LlmUsage } from "@mindforge/llm";
import { LESSONS_DIR, type Change } from "@mindforge/workspace";
import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  AGENT_GATEWAY,
  type AgentEvent,
  type AgentGateway,
  type AgentRunRequest,
} from "./agent.port.js";
import { LLM_CALL_SINK, type LlmCallSink, type RecordedCall } from "./llm-call.port.js";
import { WorkspaceSync } from "./workspace-sync.js";

/**
 * materialize → brief → run → sync → reindex → delete (§7.3).
 *
 * Every decision lives here rather than in a gateway, because
 * `vitest.config.ts` excludes `infrastructure/**` from coverage on the grounds
 * that adapters are proved by running them. A branch in the adapter is a branch
 * nothing measures.
 *
 * Four rules shape the loop, and three of them are things §7.3's sketch had
 * backwards:
 *
 * 1. **Persist inside the loop, never after it.** A failing `query()` yields its
 *    result message and *then* throws, so anything after the `for await` is
 *    skipped on every failure path — the `llm_calls` rows, the sync, the run
 *    status. The sketch put all three there.
 * 2. **Assert the handshake.** A bad plugin path is skipped silently, and the run
 *    then writes a plausible lesson from parametric memory.
 * 3. **A success with no lesson is a failure.** `SKILL.md` tells the agent to
 *    question the user when the mission is thin; unattended, it asks, nothing
 *    answers, and the run ends having written nothing while reporting success.
 *    That is the largest stall risk in the milestone and the cheapest to catch.
 * 4. **The workspace is deleted whatever happens.** Railway's disk is ephemeral
 *    by design, and a run's workspace is somebody's private learning history.
 */

/** §7.3's hard timeout. Ours: the SDK has no session timeout of any kind. */
const TIMEOUT_MS = 15 * 60_000;
const MAX_TURNS = 40;
/**
 * A second cap, denominated in the thing that actually hurts. Unlike the turn
 * cap it also counts subagents, and unlike `usage` it is what the run is billed.
 */
const MAX_BUDGET_USD = 5;

/**
 * A refusal that must end the run, as opposed to the SDK's own throw.
 *
 * `query()` yields its result message and *then* throws on every non-success
 * path, so the loop has to swallow that — otherwise the `llm_calls` rows and the
 * sync are lost, which is exactly the bug §7.3's sketch had. But the loop also
 * raises its own errors: the handshake assertion, and a heartbeat that reports
 * the run was reaped. Those mean "stop, something is wrong", and a single
 * `catch` cannot tell them apart from the expected one without a marker.
 *
 * Without this the two failure modes collapse and the dangerous one wins
 * quietly: a run with no skill loaded would sync its parametric-memory lesson
 * and report success.
 */
export class TeachAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeachAbort";
  }
}

export interface TeachRunOutcome {
  readonly status: "succeeded" | "succeeded_with_conflicts" | "failed";
  readonly changes: readonly Change[];
  readonly lessonsWritten: readonly string[];
}

@Injectable()
export class TeachRun {
  private readonly logger = new Logger(TeachRun.name);

  constructor(
    @Inject(AGENT_GATEWAY) private readonly agent: AgentGateway,
    @Inject(LLM_CALL_SINK) private readonly calls: LlmCallSink,
    private readonly sync: WorkspaceSync,
    private readonly runs: TeachRuns,
  ) {}

  async execute(input: {
    readonly runId: string;
    readonly userId: string;
    readonly missionId: string;
    readonly workspaceKey: string;
    readonly briefing: string;
    readonly pluginDir: string;
    readonly skillRef: string;
  }): Promise<TeachRunOutcome> {
    const { dir, baseline } = await this.sync.materialize(input);

    try {
      // Regenerated every run and excluded from sync-back, so this write cannot
      // appear in the diff (§7.4).
      await dir.write("BRIEFING.md", new TextEncoder().encode(input.briefing));

      const seen = await this.drive(input, {
        cwd: dir.root,
        pluginDir: input.pluginDir,
        skillRef: input.skillRef,
        timeoutMs: TIMEOUT_MS,
        maxTurns: MAX_TURNS,
        maxBudgetUsd: MAX_BUDGET_USD,
      });

      const synced = await this.sync.syncBack({ ...input, dir, baseline });
      const lessons = lessonsIn(synced.changes);

      // Rule 3, and deliberately not conditioned on what the SDK reported.
      // `skills/UNATTENDED.md` puts it the same way: a run that ends without a
      // new file under `lessons/` is a failed run, whatever else happened. It
      // catches the whole class at once — a run that asked a question and waited,
      // one that researched until its turn cap, one that tidied the workspace and
      // stopped.
      if (lessons.length === 0) {
        return this.fail(input, synced.changes, "The run finished without writing a lesson.");
      }

      const status = synced.conflicts.length > 0 ? "succeeded_with_conflicts" : "succeeded";
      await this.runs.finish(input.userId, input.runId, {
        status,
        result: resultOf(seen, synced.changes, synced.conflicts),
        error: null,
      });

      return { status, changes: synced.changes, lessonsWritten: lessons };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Teach run ${input.runId} failed: ${message}`);
      return this.fail(input, [], message);
    } finally {
      // Whatever happened. Ephemeral by design (§7.3), and the directory holds
      // somebody's private learning history.
      await dir.dispose();
    }
  }

  /**
   * Consume the agent's events, writing as they arrive.
   *
   * Returns what the terminal result said. The `llm_calls` rows are already
   * written by the time this returns — including on the failure path, which is
   * the whole reason the loop is shaped this way.
   */
  private async drive(
    input: { runId: string; userId: string },
    request: AgentRunRequest,
  ): Promise<{ ok: boolean; turns: number; durationMs: number; sdkCostUsd: number }> {
    const calls = new Map<string, RecordedCall>();
    let terminal = { ok: false, turns: 0, durationMs: 0, sdkCostUsd: 0 };

    try {
      for await (const event of this.agent.run(request)) {
        await this.onEvent(event, { ...input, skillRef: request.skillRef }, calls, (result) => {
          terminal = result;
        });
      }
    } catch (error) {
      // The rows are written in `finally`, so both paths keep them.
      if (error instanceof TeachAbort) {
        await this.calls.record(input.userId, input.runId, [...calls.values()]);
        throw error;
      }
      // Expected on every non-success path: the generator yields its result and
      // then throws. Re-raising here would lose the rows and the sync, which is
      // precisely the bug the sketch had.
      this.logger.warn(
        `Agent run ${input.runId} ended with: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.calls.record(input.userId, input.runId, [...calls.values()]);
    return terminal;
  }

  private async onEvent(
    event: AgentEvent,
    input: { runId: string; userId: string; skillRef: string },
    calls: Map<string, RecordedCall>,
    setTerminal: (result: {
      ok: boolean;
      turns: number;
      durationMs: number;
      sdkCostUsd: number;
    }) => void,
  ): Promise<void> {
    if (event.type === "init") {
      // Rule 2. A run with no skill is indistinguishable from a run with one
      // except in what it writes, so this is the only place it can be caught.
      const missing: string[] = [];
      if (!event.init.skills.includes(input.skillRef)) {
        missing.push(`${input.skillRef} did not load — the plugin path is skipped silently`);
      }
      if (event.init.tools.includes("Bash")) {
        missing.push("Bash was not withheld from the tool list");
      }
      if (missing.length > 0) throw new TeachAbort(`Refusing to teach: ${missing.join("; ")}.`);
      return;
    }

    if (event.type === "call") {
      // Deduplicated by key: parallel tool calls emit several assistant messages
      // sharing one id and one cumulative usage figure, so a row each multiplies
      // the reported cost by the parallelism factor — silently, and upward.
      calls.set(event.call.key, {
        key: event.call.key,
        purpose: "teach_turn",
        model: event.call.model,
        usage: {
          inputTokens: event.call.inputTokens,
          outputTokens: event.call.outputTokens,
          cacheReadTokens: event.call.cacheReadTokens,
          cacheWriteTokens: event.call.cacheWriteTokens,
        },
        costUsd: priceOrNull(event.call.model, {
          inputTokens: event.call.inputTokens,
          outputTokens: event.call.outputTokens,
          cacheReadTokens: event.call.cacheReadTokens,
          cacheWriteTokens: event.call.cacheWriteTokens,
        }),
      });

      // Liveness. A `false` means the run was reaped or cancelled underneath us,
      // and carrying on would have two agents writing one workspace.
      const alive = await this.runs.heartbeat(input.userId, input.runId);
      if (!alive) {
        throw new TeachAbort("This run is no longer active; another may now own the mission.");
      }
      return;
    }

    if (event.type === "result") {
      // The reconciliation §8.6 exists for. The message stream is not the bill:
      // in the M3 probe a whole model — 22% of the run's cost — never appeared as
      // an assistant message at all. One row per model for the residual makes a
      // run's calls sum to its modelUsage.
      for (const usage of event.modelUsage) {
        const attributed = [...calls.values()]
          .filter((call) => matches(call.model, usage))
          .reduce(
            (total, call) => ({
              inputTokens: total.inputTokens + call.usage.inputTokens,
              outputTokens: total.outputTokens + call.usage.outputTokens,
              cacheReadTokens: total.cacheReadTokens + call.usage.cacheReadTokens,
              cacheWriteTokens: total.cacheWriteTokens + call.usage.cacheWriteTokens,
            }),
            { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          );

        const residual: LlmUsage = {
          inputTokens: Math.max(0, usage.inputTokens - attributed.inputTokens),
          outputTokens: Math.max(0, usage.outputTokens - attributed.outputTokens),
          cacheReadTokens: Math.max(0, usage.cacheReadTokens - attributed.cacheReadTokens),
          cacheWriteTokens: Math.max(0, usage.cacheWriteTokens - attributed.cacheWriteTokens),
        };

        if (residual.inputTokens + residual.outputTokens === 0) continue;

        calls.set(`overhead:${usage.model}`, {
          key: `overhead:${usage.model}`,
          purpose: "teach_overhead",
          model: usage.canonicalModel ?? usage.model,
          usage: residual,
          costUsd: priceOrNull(usage.canonicalModel ?? usage.model, residual),
        });
      }

      setTerminal({
        ok: event.ok,
        turns: event.turns,
        durationMs: event.durationMs,
        sdkCostUsd: event.sdkCostUsd,
      });
    }
  }

  private async fail(
    input: { userId: string; runId: string },
    changes: readonly Change[],
    error: string,
  ): Promise<TeachRunOutcome> {
    await this.runs
      .finish(input.userId, input.runId, { status: "failed", result: null, error })
      // The run may already have been reaped, which is a legal outcome rather
      // than something to crash the worker over.
      .catch(() => undefined);
    return { status: "failed", changes, lessonsWritten: [] };
  }
}

function lessonsIn(changes: readonly Change[]): readonly string[] {
  return changes
    .filter((change) => change.kind === "added" || change.kind === "modified")
    .map((change) => change.path)
    .filter((path) => path.startsWith(`${LESSONS_DIR}/`));
}

function matches(model: string, usage: { model: string; canonicalModel: string | null }): boolean {
  return model === usage.model || model === usage.canonicalModel;
}

/**
 * Price it, or record that we could not.
 *
 * `estimateCostUsd` throws on a model it has no price for, and that throw would
 * happen inside the message loop and kill the run. A missing price is unknown,
 * and unknown is not zero (non-negotiable 10) — hence null rather than 0.
 */
function priceOrNull(model: string, usage: LlmUsage): number | null {
  try {
    return estimateCostUsd(model, usage);
  } catch {
    return null;
  }
}

function resultOf(
  seen: { turns: number; durationMs: number; sdkCostUsd: number },
  changes: readonly Change[],
  conflicts: readonly { path: string; reason: string }[],
): AgentRunResult {
  return {
    turns: seen.turns,
    durationMs: seen.durationMs,
    sdkCostUsd: seen.sdkCostUsd,
    changes: {
      added: changes.filter((c) => c.kind === "added").map((c) => c.path),
      modified: changes.filter((c) => c.kind === "modified").map((c) => c.path),
      deleted: changes.filter((c) => c.kind === "deleted").map((c) => c.path),
    },
    conflicts: conflicts.map((conflict) => ({ path: conflict.path, reason: conflict.reason })),
  };
}
