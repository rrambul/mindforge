export const AGENT_GATEWAY = Symbol("AgentGateway");

/**
 * One model call, as `llm_calls` needs it.
 *
 * `model` is the raw id the SDK reported, which may be dated
 * (`claude-haiku-4-5-20251001`) where the pricing table is canonical — the
 * caller canonicalises, because pricing an uncanonical id throws and that throw
 * would happen inside the message loop (§8.6).
 */
export interface AgentCall {
  /** `request_id` where present, `message.id` otherwise. Both were populated in the probe. */
  readonly key: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** Whole-tree usage per model, from the terminal result's `modelUsage`. */
export interface AgentModelUsage {
  readonly model: string;
  /** The id the pricing table knows, where the SDK could supply one. */
  readonly canonicalModel: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
}

/**
 * What the run's opening handshake claimed about itself.
 *
 * Asserted rather than logged. A nonexistent plugin path is skipped silently, so
 * a run with no skill looks exactly like a run with one — it just writes a lesson
 * from parametric memory, which is the single thing `SKILL.md` forbids.
 */
export interface AgentInit {
  readonly plugins: readonly string[];
  readonly skills: readonly string[];
  readonly tools: readonly string[];
  readonly model: string;
  readonly cliVersion: string;
}

export type AgentEvent =
  | { readonly type: "init"; readonly init: AgentInit }
  /** One assistant message. Carries usage, and is the liveness tick. */
  | { readonly type: "call"; readonly call: AgentCall }
  /** A tool the agent used, for the run trace (§12). */
  | { readonly type: "tool"; readonly name: string }
  | {
      readonly type: "result";
      /**
       * `success` means the SDK finished cleanly. It does **not** mean a lesson
       * was written — `TeachRun` decides that, because a run that asked a question
       * and stopped also reports success.
       */
      readonly ok: boolean;
      readonly subtype: string;
      readonly turns: number;
      readonly durationMs: number;
      /** The SDK's own estimate. Stored as a cross-check, never billed from. */
      readonly sdkCostUsd: number;
      readonly modelUsage: readonly AgentModelUsage[];
      readonly errors: readonly string[];
    };

export interface AgentRunRequest {
  /** The materialised workspace. */
  readonly cwd: string;
  /** Where the composed teach plugin was written. */
  readonly pluginDir: string;
  /** The namespaced skill reference the run must load. */
  readonly skillRef: string;
  readonly timeoutMs: number;
  readonly maxTurns: number;
  readonly maxBudgetUsd: number;
}

export interface AgentGateway {
  /**
   * Run the agent, yielding events as they arrive.
   *
   * An async generator rather than a promise, because the caller has to persist
   * inside the loop: a failing `query()` **yields its result message and then
   * throws**, so anything written after the loop never runs on a failure path.
   * That was the ninth thing §7.3's sketch got wrong.
   */
  run(request: AgentRunRequest): AsyncGenerator<AgentEvent, void>;
}
