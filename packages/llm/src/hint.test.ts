import type { CodeExercise, RequestHintInput } from "@mindforge/core";
import { describe, expect, it } from "vitest";

import Anthropic from "@anthropic-ai/sdk";

import {
  buildHintRequest,
  HINT_FALLBACK_BETA,
  HINT_MODEL,
  HINT_SYSTEM,
  ModelCallError,
  readHintResponse,
  requestHint,
} from "./hint.js";

const EXERCISE: CodeExercise = {
  key: "commit-index",
  kind: "code",
  language: "typescript",
  title: "Which entries are committed?",
  prompt: "Return the highest index on a majority.",
  starter: "export function committedIndex() { return 0; }",
  tests: 'test("three nodes", () => expect(committedIndex([5, 3, 1])).toBe(3));',
  solution: "export function committedIndex(m) { /* the answer */ }",
  expectedMinutes: 10,
};

const HINT: RequestHintInput = {
  level: 2,
  code: "export function committedIndex() { return 0; }",
  lastRun: {
    status: "completed",
    message: null,
    results: [{ name: "three nodes", passed: false, message: "expected 0 to be 3" }],
  },
  question: null,
};

function userText(params: ReturnType<typeof buildHintRequest>): string {
  const content = params.messages[0]!.content;
  return typeof content === "string" ? content : "";
}

describe("buildHintRequest", () => {
  it("keeps the system prompt frozen, so it caches across learners and exercises", () => {
    const one = buildHintRequest({ exercise: EXERCISE, hint: HINT, language: "en" });
    const two = buildHintRequest({
      exercise: { ...EXERCISE, title: "Something else" },
      hint: { ...HINT, level: 5, question: "why?" },
      language: "pt-BR",
    });

    // A prefix match: one byte of per-request content in here and every hint pays
    // full price for the ladder instructions.
    expect(one.system).toEqual(two.system);
    expect(JSON.stringify(one.system)).not.toContain("Which entries");
    expect(one.system).toEqual([
      { type: "text", text: HINT_SYSTEM, cache_control: { type: "ephemeral" } },
    ]);
  });

  it("names the rung, the language, the learner's code and the failing test", () => {
    const text = userText(buildHintRequest({ exercise: EXERCISE, hint: HINT, language: "pt-BR" }));

    expect(text).toContain("Rung: 2 of 5 — clue.");
    expect(text).toContain("Answer in this language: pt-BR.");
    expect(text).toContain("<learner_code>\nexport function committedIndex() { return 0; }");
    expect(text).toContain("FAIL three nodes — expected 0 to be 3");
  });

  it("says when the code has not been run, rather than implying it passed", () => {
    const text = userText(
      buildHintRequest({ exercise: EXERCISE, hint: { ...HINT, lastRun: null }, language: "en" }),
    );

    expect(text).toContain("They have not run the tests on this code yet.");
  });

  it("carries the learner's own question when there is one", () => {
    const text = userText(
      buildHintRequest({
        exercise: EXERCISE,
        hint: { ...HINT, question: "Why sort descending?" },
        language: "en",
      }),
    );

    expect(text).toContain("<learner_question>\nWhy sort descending?\n</learner_question>");
  });

  it("grounds the model in the reference solution only when the lesson has one", () => {
    const withSolution = userText(
      buildHintRequest({ exercise: EXERCISE, hint: HINT, language: "en" }),
    );
    const without = userText(
      buildHintRequest({ exercise: { ...EXERCISE, solution: null }, hint: HINT, language: "en" }),
    );

    expect(withSolution).toContain("reference solution (never show it below rung 5)");
    expect(without).not.toContain("reference solution");
  });

  it("asks the reasoning model at low effort, with server-side refusal fallbacks", () => {
    const params = buildHintRequest({ exercise: EXERCISE, hint: HINT, language: "en" });

    expect(params).toMatchObject({
      model: HINT_MODEL,
      output_config: { effort: "low" },
      betas: [HINT_FALLBACK_BETA],
      fallbacks: "default",
    });
    // Rejected by current models, and never needed: the ladder is in the prompt.
    expect(params).not.toHaveProperty("temperature");
  });
});

function message(over: Partial<Anthropic.Beta.BetaMessage>): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 900,
      output_tokens: 80,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 0,
    },
    ...over,
  } as Anthropic.Beta.BetaMessage;
}

describe("readHintResponse", () => {
  it("reads the text and the usage, including cache reads", () => {
    const read = readHintResponse(
      message({
        content: [{ type: "text", text: "  Which way is the list sorted?  ", citations: null }],
      }),
    );

    expect(read.answer).toEqual({ kind: "hint", text: "Which way is the list sorted?" });
    expect(read.usage).toEqual({
      inputTokens: 900,
      outputTokens: 80,
      cacheReadTokens: 400,
      cacheWriteTokens: 0,
    });
  });

  it("prices by the model that answered, which a fallback may have changed", () => {
    expect(readHintResponse(message({ model: "claude-opus-4-8" })).model).toBe("claude-opus-4-8");
  });

  it("never shows a refusal as a hint", () => {
    expect(readHintResponse(message({ stop_reason: "refusal" })).answer).toEqual({
      kind: "refused",
    });
  });

  it("calls an answer with no text empty, rather than an empty hint", () => {
    expect(readHintResponse(message({ content: [] })).answer).toEqual({ kind: "empty" });
  });
});

describe("requestHint", () => {
  it("sends the built request and keeps the request id for the cost row", async () => {
    const sent: unknown[] = [];
    const client = {
      beta: {
        messages: {
          create: (params: unknown) => {
            sent.push(params);
            return Promise.resolve({
              ...message({
                content: [{ type: "text", text: "Look at the sort.", citations: null }],
              }),
              _request_id: "req_1",
            });
          },
        },
      },
    } as unknown as Pick<Anthropic, "beta">;

    const call = await requestHint(client, { exercise: EXERCISE, hint: HINT, language: "en" });

    expect(sent).toHaveLength(1);
    expect(call).toMatchObject({
      answer: { kind: "hint", text: "Look at the sort." },
      requestId: "req_1",
    });
  });
});

describe("requestHint's failures", () => {
  function failing(error: Error) {
    return {
      beta: { messages: { create: () => Promise.reject(error) } },
    } as unknown as Pick<Anthropic, "beta">;
  }
  const input = { exercise: EXERCISE, hint: HINT, language: "en" };
  const apiError = (status: number) =>
    Anthropic.APIError.generate(
      status,
      { type: "error", error: { type: "x", message: "no" } },
      "no",
      new Headers(),
    );

  it.each([400, 401, 403, 404])(
    "calls HTTP %i a configuration problem, which retrying will not fix",
    async (status) => {
      // 400 is where "your credit balance is too low" arrives.
      await expect(requestHint(failing(apiError(status)), input)).rejects.toMatchObject({
        name: "ModelCallError",
        reason: "configuration",
        status,
      });
    },
  );

  it.each([408, 429, 500, 529])("calls HTTP %i transient", async (status) => {
    await expect(requestHint(failing(apiError(status)), input)).rejects.toMatchObject({
      reason: "transient",
      status,
    });
  });

  it("calls a dropped connection transient", async () => {
    const error = new Anthropic.APIConnectionError({ message: "socket hang up" });

    await expect(requestHint(failing(error), input)).rejects.toBeInstanceOf(ModelCallError);
    await expect(requestHint(failing(error), input)).rejects.toMatchObject({ reason: "transient" });
  });

  it("lets anything that is not the SDK's error through untouched", async () => {
    const bug = new TypeError("a bug of ours");

    await expect(requestHint(failing(bug), input)).rejects.toBe(bug);
  });
});
