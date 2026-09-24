import Anthropic from "@anthropic-ai/sdk";
import type { WhiteboardExercise } from "@mindforge/core";
import { describe, expect, it } from "vitest";

import { ModelCallError } from "./hint.js";
import {
  alignReview,
  buildReviewRequest,
  pngBase64,
  requestReview,
  REVIEW_MAX_RETRIES,
  REVIEW_SYSTEM,
  REVIEW_TIMEOUT_MS,
} from "./review.js";

const EXERCISE: WhiteboardExercise = {
  key: "url-shortener",
  kind: "whiteboard",
  title: "Design a URL shortener",
  prompt: "Draw the write and the read path.",
  rubric: ["Separates the read path from the write path", "Caches hot redirects"],
  solution: null,
  expectedMinutes: 20,
};

const INPUT = {
  exercise: EXERCISE,
  sceneDescription: "Shapes:\n- rectangle: API",
  imageBase64: "iVBORw0KGgo=",
  language: "pt-BR",
};

describe("buildReviewRequest", () => {
  it("keeps the system prompt frozen, so it caches across every review", () => {
    const one = buildReviewRequest(INPUT);
    const two = buildReviewRequest({ ...INPUT, exercise: { ...EXERCISE, title: "Other" } });

    expect(one.system).toEqual(two.system);
    expect(one.system[0]!.text).toBe(REVIEW_SYSTEM);
  });

  it("sends the drawing as an image first, then the rubric by index and the scene", () => {
    const [image, text] = buildReviewRequest(INPUT).messages[0]!.content;

    expect(image).toMatchObject({
      type: "image",
      source: { media_type: "image/png", data: "iVBORw0KGgo=" },
    });
    expect(text).toMatchObject({ type: "text" });
    const body = (text as { text: string }).text;
    expect(body).toContain(
      "0. Separates the read path from the write path\n1. Caches hot redirects",
    );
    expect(body).toContain("<scene>\nShapes:\n- rectangle: API\n</scene>");
    expect(body).toContain("in this language: pt-BR");
  });

  it("asks for a structured answer, with refusal fallbacks and no sampling knobs", () => {
    const params = buildReviewRequest(INPUT);

    expect(params.output_config.format).toBeDefined();
    expect(params).toMatchObject({ fallbacks: "default", output_config: { effort: "medium" } });
    expect(params).not.toHaveProperty("temperature");
  });
});

describe("pngBase64", () => {
  it("strips the data-URL prefix a browser export carries, and leaves bare base64 alone", () => {
    expect(pngBase64("data:image/png;base64,AAAA")).toBe("AAAA");
    expect(pngBase64("AAAA")).toBe("AAAA");
  });
});

describe("alignReview", () => {
  const rubric = EXERCISE.rubric;

  it("lines each verdict up with its rubric item, by index", () => {
    const answer = alignReview(rubric, {
      items: [
        { index: 1, verdict: "missing", note: "No cache box on the read path." },
        { index: 0, verdict: "covered", note: " Two services, one each way. " },
      ],
      overall: "Clear split; no cache.",
    });

    expect(answer).toEqual({
      kind: "review",
      items: [
        { item: rubric[0], verdict: "covered", note: "Two services, one each way." },
        { item: rubric[1], verdict: "missing", note: "No cache box on the read path." },
      ],
      overall: "Clear split; no cache.",
    });
  });

  it("calls an answer that skipped an item empty, rather than inventing 'missing' for it", () => {
    expect(
      alignReview(rubric, {
        items: [{ index: 0, verdict: "covered", note: "yes" }],
        overall: "x",
      }),
    ).toEqual({ kind: "empty" });
  });

  it("calls a duplicated or out-of-range index empty", () => {
    const twice = { index: 0, verdict: "covered" as const, note: "yes" };
    expect(alignReview(rubric, { items: [twice, twice], overall: "x" })).toEqual({ kind: "empty" });
    expect(
      alignReview(rubric, {
        items: [twice, { index: 7, verdict: "covered", note: "yes" }],
        overall: "x",
      }),
    ).toEqual({ kind: "empty" });
  });

  it("calls a blank note, or no parsed output at all, empty", () => {
    expect(
      alignReview(rubric, {
        items: [
          { index: 0, verdict: "covered", note: " " },
          { index: 1, verdict: "covered", note: "yes" },
        ],
        overall: "x",
      }),
    ).toEqual({ kind: "empty" });
    expect(alignReview(rubric, null)).toEqual({ kind: "empty" });
  });
});

describe("requestReview", () => {
  const client = (create: () => Promise<unknown>) =>
    ({ beta: { messages: { create } } }) as unknown as Pick<Anthropic, "beta">;
  const message = (over: Record<string, unknown>) => ({
    model: "claude-opus-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 2_000, output_tokens: 300, cache_read_input_tokens: 0 },
    _request_id: "req_r",
    content: [],
    ...over,
  });

  it("returns the aligned review with its usage and request id", async () => {
    const call = await requestReview(
      client(() =>
        Promise.resolve(
          message({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  items: [
                    { index: 0, verdict: "covered", note: "a" },
                    { index: 1, verdict: "partly", note: "b" },
                  ],
                  overall: "c",
                }),
              },
            ],
          }),
        ),
      ),
      INPUT,
    );

    expect(call.answer.kind).toBe("review");
    expect(call).toMatchObject({ model: "claude-opus-5", requestId: "req_r" });
    expect(call.usage).toMatchObject({
      inputTokens: 2_000,
      outputTokens: 300,
      cacheWriteTokens: 0,
    });
  });

  it("never shows a refusal as a review", async () => {
    const call = await requestReview(
      client(() => Promise.resolve(message({ stop_reason: "refusal" }))),
      INPUT,
    );

    expect(call.answer).toEqual({ kind: "refused" });
  });

  it("classifies a failed call the same way a hint's is", async () => {
    const error = Anthropic.APIError.generate(
      400,
      { type: "error", error: { type: "x", message: "credit" } },
      "credit",
      new Headers(),
    );

    await expect(
      requestReview(
        client(() => Promise.reject(error)),
        INPUT,
      ),
    ).rejects.toBeInstanceOf(ModelCallError);
  });
});

describe("a review that comes back unusable is billed, not thrown", () => {
  // Review finding: `messages.parse` throws when the structured output does not
  // parse — a reply cut off at `max_tokens`, or JSON a fallback model got wrong —
  // and that error is not an API error, so it skipped the billing path entirely.
  const created = (text: string, stop_reason = "end_turn") =>
    ({
      beta: {
        messages: {
          create: () =>
            Promise.resolve({
              model: "claude-opus-5",
              stop_reason,
              content: [{ type: "text", text }],
              usage: { input_tokens: 2_000, output_tokens: 8_000 },
              _request_id: "req_cut",
            }),
        },
      },
    }) as unknown as Pick<Anthropic, "beta">;

  it("treats JSON cut off at the token limit as empty, with its usage kept for the bill", async () => {
    const call = await requestReview(created('{"items": [{"index": 0, "verd', "max_tokens"), INPUT);

    expect(call.answer).toEqual({ kind: "empty" });
    expect(call.usage.outputTokens).toBe(8_000);
    expect(call.requestId).toBe("req_cut");
  });

  it("treats JSON that does not match the shape as empty", async () => {
    const call = await requestReview(created('{"items": "nope", "overall": 1}'), INPUT);

    expect(call.answer).toEqual({ kind: "empty" });
  });

  it("reads a well-formed answer from the text", async () => {
    const call = await requestReview(
      created(
        JSON.stringify({
          items: [
            { index: 0, verdict: "covered", note: "a" },
            { index: 1, verdict: "missing", note: "b" },
          ],
          overall: "c",
        }),
      ),
      INPUT,
    );

    expect(call.answer.kind).toBe("review");
  });
});

describe("the review client", () => {
  it("allows a review longer than a hint, and does not retry a timed-out call", () => {
    // Review finding: reviews borrowed the hint client's 30-second timeout and its
    // retry, so a real image review timed out, was paid for twice, and failed.
    expect(REVIEW_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
    expect(REVIEW_MAX_RETRIES).toBe(0);
  });
});
