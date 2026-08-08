import type { PrismaClient } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";

import { PRISMA } from "../../../shared/prisma.js";
import type { LlmCallSink, RecordedCall } from "../application/llm-call.port.js";

/**
 * `llm_calls`, written once per run.
 *
 * `skipDuplicates` rather than an upsert, and that is the idempotency: the
 * partial unique index on `(agent_run_id, call_key)` means a replayed message
 * stream — a retried run, a resumed session — cannot bill a user twice. An
 * upsert would instead *revise* a row whose usage is already correct, which is
 * the same number written again at best and a double-counted turn at worst.
 *
 * Non-negotiable 9: cost tracking ships with the first LLM call, not after.
 */
@Injectable()
export class PrismaLlmCallSink implements LlmCallSink {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async record(userId: string, agentRunId: string, calls: readonly RecordedCall[]): Promise<void> {
    if (calls.length === 0) return;

    await this.prisma.llmCall.createMany({
      data: calls.map((call) => ({
        userId,
        agentRunId,
        purpose: call.purpose,
        model: call.model,
        callKey: call.key,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
        cacheReadTokens: call.usage.cacheReadTokens,
        cacheWriteTokens: call.usage.cacheWriteTokens,
        // Null, never 0. A model with no price is unknown, and a zero here would
        // quietly understate the cost meter and the monthly cap.
        costUsd: call.costUsd,
      })),
      skipDuplicates: true,
    });
  }
}
