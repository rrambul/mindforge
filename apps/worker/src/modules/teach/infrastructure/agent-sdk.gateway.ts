import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Inject, Injectable } from "@nestjs/common";

import { ENV, type Env } from "../../../shared/env.js";
import type {
  AgentEvent,
  AgentGateway,
  AgentModelUsage,
  AgentRunRequest,
} from "../application/agent.port.js";

/**
 * `query()`, translated into the events `TeachRun` decides from.
 *
 * Everything vendor-specific about §7.3 is here, and the options object is the
 * part that was verified rather than sketched. The five that matter, each because
 * getting it wrong fails silently:
 *
 * - **`tools` + `disallowedTools` + `permissionMode`, not `allowedTools`.** The
 *   SDK's own doc comment says `allowedTools` auto-approves and directs you to
 *   `tools` to restrict. The previous design listed six tools there and commented
 *   "No Bash"; Bash was never withheld.
 * - **`abortController`, not `abortSignal`.** The option the sketch used does not
 *   exist, and the SDK has no session timeout of any kind — the deadline is ours.
 * - **`env` replaces rather than merges.** Omitting the spread strips `PATH`,
 *   `HOME` and `ANTHROPIC_API_KEY`, and the run fails to authenticate.
 * - **`settingSources: []`.** Otherwise the run inherits the host's `~/.claude` —
 *   on a dev machine, the developer's own config inside a user's lesson.
 * - **`plugins` + `skills`**, because copying `SKILL.md` into the workspace makes
 *   it a file rather than a skill, and a bad plugin path is skipped in silence.
 */

const TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"] as const;

@Injectable()
export class AgentSdkGateway implements AgentGateway {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async *run(request: AgentRunRequest): AsyncGenerator<AgentEvent, void> {
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
    }, request.timeoutMs);

    try {
      for await (const message of query({
        prompt:
          "Teach me the next thing. Read BRIEFING.md first — it has my current zone of " +
          "proximal development, weak skills, and what is not measured yet.",
        options: {
          cwd: request.cwd,
          model: "claude-opus-5",
          effort: "high",
          maxTurns: request.maxTurns,
          maxBudgetUsd: request.maxBudgetUsd,
          abortController: controller,
          tools: [...TOOLS],
          disallowedTools: ["Bash"],
          permissionMode: "dontAsk",
          allowedTools: [...TOOLS],
          plugins: [{ type: "local", path: request.pluginDir }],
          skills: [request.skillRef],
          settingSources: [],
          strictMcpConfig: true,
          // The spread is load-bearing. A per-run config directory keeps one
          // user's session from reading the host's settings; in production the
          // key is what authenticates, so no config directory is needed at all.
          env: { ...process.env, ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY },
          stderr: () => {
            // Swallowed rather than logged: the CLI writes progress noise here,
            // and a worker log full of it makes a real error unfindable.
          },
        },
      })) {
        const event = translate(message);
        if (event) yield event;
      }
    } finally {
      clearTimeout(deadline);
    }
  }
}

function translate(message: SDKMessage): AgentEvent | null {
  if (message.type === "system" && message.subtype === "init") {
    return {
      type: "init",
      init: {
        plugins: message.plugins.map((plugin) => plugin.name),
        skills: message.skills,
        tools: message.tools,
        model: message.model,
        cliVersion: message.claude_code_version,
      },
    };
  }

  if (message.type === "assistant") {
    const usage = message.message.usage;
    return {
      type: "call",
      call: {
        // `request_id` where the SDK supplied one, `message.id` otherwise. Both
        // were populated in the probe, but the type marks the first optional.
        key: message.request_id ?? message.message.id,
        model: message.message.model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
    };
  }

  if (message.type === "result") {
    return {
      type: "result",
      ok: message.subtype === "success",
      subtype: message.subtype,
      turns: message.num_turns,
      durationMs: message.duration_ms,
      // The SDK's own estimate, from a price table baked in at build time. Its
      // docs say not to bill from it, so it is carried as a cross-check only.
      sdkCostUsd: message.total_cost_usd,
      // `modelUsage`, never `usage`: the latter covers the main model only and
      // excludes subagents, and the probe showed a whole model missing from the
      // message stream entirely.
      modelUsage: Object.entries(message.modelUsage).map(([model, used]): AgentModelUsage => ({
        model,
        canonicalModel: used.canonicalModel ?? null,
        inputTokens: used.inputTokens,
        outputTokens: used.outputTokens,
        cacheReadTokens: used.cacheReadInputTokens,
        cacheWriteTokens: used.cacheCreationInputTokens,
        costUsd: used.costUSD,
      })),
      // `SDKResultError` has `errors`; `SDKResultSuccess` does not, which is why
      // this reads the discriminant rather than the field.
      errors: message.subtype === "success" ? [] : message.errors,
    };
  }

  return null;
}
