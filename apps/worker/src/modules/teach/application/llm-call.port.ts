import type { LlmUsage } from "@mindforge/llm";

export const LLM_CALL_SINK = Symbol("LlmCallSink");

export interface RecordedCall {
  /**
   * Per-run idempotency key: `request_id` where the SDK supplied one,
   * `message.id` otherwise. Both were populated in the M3 probe, but `request_id`
   * is optional on the type — hence the fallback, and hence a nullable column.
   */
  readonly key: string;
  /** `teach_turn` for a visible assistant message; `teach_overhead` for the residual. */
  readonly purpose: string;
  readonly model: string;
  readonly usage: LlmUsage;
  /**
   * Null when the model has no price.
   *
   * Not zero. The SDK reports whatever id it used and one absent from
   * `packages/llm`'s table has no price, which is a different fact from costing
   * nothing (non-negotiable 10).
   */
  readonly costUsd: number | null;
}

export interface LlmCallSink {
  /**
   * Write a run's calls.
   *
   * Idempotent on `(agent_run_id, call_key)`, so a replayed message stream — a
   * retried run, a resumed session — cannot bill a user twice. That is enforced
   * by the partial unique index rather than by a check here.
   */
  record(userId: string, agentRunId: string, calls: readonly RecordedCall[]): Promise<void>;
}
