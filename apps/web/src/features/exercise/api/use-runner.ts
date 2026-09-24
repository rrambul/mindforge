import {
  PYTHON_LOAD_TIMEOUT_MS,
  RUNNER_TIMEOUT_MS,
  RunnerReadySchema,
  RunnerResponseSchema,
  type ExerciseLanguage,
  type RunnerRequest,
  type RunnerResponse,
  type RunnerWarm,
} from "@mindforge/core";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * The bridge to the test runner: a sandboxed frame on the lessons origin (FR-X4).
 *
 * The runner executes agent-written tests against the learner's code, so it runs
 * where lesson HTML runs — on the other origin, in `sandbox="allow-scripts"` with
 * no `allow-same-origin` — and everything that comes back from it is untrusted
 * data. Three checks, all required, on every message:
 *
 * 1. **`event.source` is our frame's window.** Not `event.origin`: a sandboxed
 *    frame's origin is the opaque `"null"`, which any other sandboxed frame on the
 *    page shares — a lesson's included. The window identity is what cannot be forged.
 * 2. **It parses** with the schema in `packages/core`. Never `eval`, never a field
 *    read off an unchecked object.
 * 3. **Its `runId` is the run we are waiting for.** A slow answer to a previous run
 *    must never be shown as the answer to this one.
 *
 * Requests go out with `targetOrigin: "*"`, and that is not the laxity it looks
 * like: an opaque origin cannot be named, and the payload is the learner's own code
 * and the tests, which the lesson already had.
 *
 * **The runner kills its own worker at `RUNNER_TIMEOUT_MS`.** This side waits two
 * seconds longer and then assumes the frame itself is wedged — a loop that escaped
 * the worker, a frame that never loaded — tears it down and builds a new one. The
 * run is reported as a timeout either way, because from the learner's side it was.
 */

/** How long this side waits for the runner's own verdict before replacing the frame. */
export const BRIDGE_TIMEOUT_MS = RUNNER_TIMEOUT_MS + 2_000;

/**
 * Per language, because a Python run can include starting Python. The runner
 * bounds that start with its own `PYTHON_LOAD_TIMEOUT_MS` and only then starts the
 * run's clock, so this side must wait for both — or it would tear down a frame
 * that was about to answer, on exactly the first run a learner makes.
 */
export function bridgeTimeoutFor(language: ExerciseLanguage): number {
  return language === "python" ? PYTHON_LOAD_TIMEOUT_MS + BRIDGE_TIMEOUT_MS : BRIDGE_TIMEOUT_MS;
}

export type RunOutcome = Omit<RunnerResponse, "type" | "runId">;

export interface RunInput {
  readonly language: ExerciseLanguage;
  readonly code: string;
  readonly tests: string;
}

export interface Runner {
  /** Give to the frame. `generation` is its React key: a new one is a new frame. */
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly generation: number;
  /** The frame has said it is listening. */
  readonly ready: boolean;
  /** A run is in flight. One at a time: the runner has one worker. */
  readonly busy: boolean;
  /**
   * Null when nothing ran: the runner was not ready, another run was in flight, or
   * the panel went away before an answer came. A caller records an attempt only for
   * a real outcome — a run that never happened is not one (review #5).
   */
  readonly run: (input: RunInput) => Promise<RunOutcome | null>;
  /** Start Python before the first run, so the first press is not the slow one. */
  readonly warm: (language: "python") => void;
}

interface Pending {
  readonly runId: string;
  readonly resolve: (outcome: RunOutcome | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** The frame did not answer in time — a real outcome, recorded as one. */
const TIMED_OUT: RunOutcome = {
  status: "timeout",
  reason: "timeout",
  results: [],
  message: null,
  logs: [],
};

export function useRunner(): Runner {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pending = useRef<Pending | null>(null);
  const counter = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const settle = useCallback((outcome: RunOutcome | null) => {
    const current = pending.current;
    if (current === null) return;
    clearTimeout(current.timer);
    pending.current = null;
    setBusy(false);
    current.resolve(outcome);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current?.contentWindow;
      if (frame === null || frame === undefined || event.source !== frame) return;

      if (RunnerReadySchema.safeParse(event.data).success) {
        setReady(true);
        return;
      }

      const response = RunnerResponseSchema.safeParse(event.data);
      if (!response.success) return;
      if (pending.current === null || response.data.runId !== pending.current.runId) return;

      const { status, reason, results, message, logs } = response.data;
      settle({ status, reason, results, message, logs });
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [settle]);

  // A run still waiting when the panel goes away resolves as nothing rather than
  // hanging a promise nobody will ever settle — and not as a timeout, which the
  // caller would record as an attempt that never happened (review #5).
  useEffect(() => () => settle(null), [settle]);

  const run = useCallback(
    (input: RunInput): Promise<RunOutcome | null> => {
      const target = frameRef.current?.contentWindow;
      if (!ready || pending.current !== null || target === null || target === undefined) {
        // The button is disabled in both states; this is the guard behind it. Nothing
        // ran, so there is nothing to report.
        return Promise.resolve(null);
      }

      counter.current += 1;
      const runId = `run-${generation}-${counter.current}`;
      const request: RunnerRequest = { type: "mindforge:run", runId, ...input };

      return new Promise<RunOutcome | null>((resolve) => {
        const timer = setTimeout(() => {
          settle(TIMED_OUT);
          // The frame did not answer in time, so it is not trusted to answer the
          // next run either. A new key is a new frame and a fresh worker.
          setReady(false);
          setGeneration((g) => g + 1);
        }, bridgeTimeoutFor(input.language));

        pending.current = { runId, resolve, timer };
        setBusy(true);
        target.postMessage(request, "*");
      });
    },
    [generation, ready, settle],
  );

  const warm = useCallback(
    (language: "python") => {
      const target = frameRef.current?.contentWindow;
      if (!ready || target === null || target === undefined) return;
      const message: RunnerWarm = { type: "mindforge:warm", language };
      target.postMessage(message, "*");
    },
    [ready],
  );

  return { frameRef, generation, ready, busy, run, warm };
}
