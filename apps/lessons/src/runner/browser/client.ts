/**
 * The runner frame's main thread: take a run from the app, hand it to a worker,
 * hand the answer back (FR-X4, TECH-DESIGN.md §7.5).
 *
 * This file runs nothing it was sent. It transpiles — which parses and never
 * executes — and everything else happens in a worker built from a Blob URL. That
 * is the whole reason there is a worker: on localhost the app and the lessons
 * origin are same-site, so this frame may share the app's process, and a
 * `while (true)` here would freeze the learner's tab. In a worker it is a thread
 * the clock below can kill.
 *
 * **One bundle, two pages.** `/runner` runs JavaScript and TypeScript under
 * `connect-src 'none'`; `/runner/python` runs Python under `connect-src 'self'`,
 * because Pyodide fetches its own interpreter. Each page names its languages in a
 * `<meta>` (`languages.ts`) and this client refuses anything else, so no run lands
 * under the looser policy by being sent to the wrong frame.
 *
 * The workers' sources are inlined at bundle time, not fetched: on the JavaScript
 * page `connect-src 'none'` forbids fetching anything, and a sandboxed frame's
 * origin is opaque, so a worker cannot be loaded by URL on either page — a Blob URL
 * is the one form that works.
 *
 * **No sentences of ours in a reply.** Every failure is a `reason` key the app
 * words in the learner's language (§5.2); `message` carries only the raw detail —
 * the compiler's or the interpreter's own text — or nothing.
 */
import {
  PYTHON_LOAD_TIMEOUT_MS,
  RUNNER_TIMEOUT_MS,
  RunnerRequestSchema,
  RunnerWarmSchema,
  type RunnerRequest,
  type RunnerResponse,
  type RunReason,
  type TestResult,
} from "@mindforge/core";
import { transform, type Transform } from "sucrase";

import type { HarnessOutput } from "../harness.js";
import { allowedLanguages, LANGUAGES_META } from "./languages.js";

declare const __RUNNER_WORKER_SOURCE__: string;
declare const __PYTHON_WORKER_SOURCE__: string;
declare const __PYODIDE_VERSION__: string;

const APP_ORIGIN_META = "mindforge:app-origin";

function meta(name: string): string | null | undefined {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.getAttribute("content");
}

const appOrigin = meta(APP_ORIGIN_META);
const allowed = allowedLanguages(meta(LANGUAGES_META));

const workerUrl = URL.createObjectURL(
  new Blob([__RUNNER_WORKER_SOURCE__], { type: "text/javascript" }),
);

const pythonWorkerUrl = URL.createObjectURL(
  new Blob([__PYTHON_WORKER_SOURCE__], { type: "text/javascript" }),
);

/**
 * Where Pyodide lives: this origin, a directory versioned by the package, so the
 * files can be cached as immutable. Absolute, because the worker's own URL is a
 * `blob:` one that nothing relative resolves against. `location` is readable in a
 * sandboxed frame — only its origin is opaque, not its address.
 */
const PYODIDE_URL = new URL(`/pyodide/${__PYODIDE_VERSION__}/`, location.href).href;

function reply(message: RunnerResponse | { type: "mindforge:ready" }): void {
  // Never `"*"` from this side: the parent's origin is known and fixed, and a
  // result names the learner's code. If the frame was somehow embedded elsewhere
  // the message is simply not delivered.
  if (appOrigin) window.parent.postMessage(message, appOrigin);
}

/**
 * Transpile to CommonJS, so the harness can hand the tests a `require` that
 * resolves `./solution` and nothing else.
 */
function compile(source: string, language: "javascript" | "typescript"): string {
  const transforms: Transform[] =
    language === "typescript" ? ["typescript", "imports"] : ["imports"];
  return transform(source, { transforms }).code;
}

/** What either worker answers, before the client stamps it with the run's id. */
interface Output {
  readonly status: RunnerResponse["status"];
  readonly reason: RunReason | null;
  readonly results: readonly TestResult[];
  readonly message: string | null;
  readonly logs: readonly string[];
}

function failure(status: "error" | "timeout", reason: RunReason, detail: string | null): Output {
  return { status, reason, results: [], message: detail, logs: [] };
}

/** Thrown when Python cannot be started. Its message is the raw cause, or empty. */
class RuntimeUnavailable extends Error {}

/**
 * Python, started once and kept warm (Phase 5).
 *
 * Two clocks, deliberately separate: `PYTHON_LOAD_TIMEOUT_MS` bounds the start,
 * and `RUNNER_TIMEOUT_MS` bounds a run and only begins once Python is ready — a
 * learner's five seconds are not spent downloading an interpreter. Runs are
 * serialised: there is one interpreter, and two runs in it at once would share
 * `sys.modules`. A run that times out takes the worker with it, because the loop
 * that caused it is still spinning; the next run starts a fresh one.
 */
class PythonRuntime {
  private worker: Worker | null = null;
  private ready: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  warm(): Promise<Worker> {
    // A failed start is not cached: `reset` clears it, and the next run tries again.
    this.ready ??= new Promise<Worker>((resolve, reject) => {
      const worker = new Worker(pythonWorkerUrl);
      this.worker = worker;
      const timer = setTimeout(() => {
        this.reset();
        reject(new RuntimeUnavailable(`no start within ${PYTHON_LOAD_TIMEOUT_MS} ms`));
      }, PYTHON_LOAD_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<{ type: string; message?: string }>) => {
        if (event.data.type === "ready") {
          clearTimeout(timer);
          resolve(worker);
        } else if (event.data.type === "failed") {
          clearTimeout(timer);
          this.reset();
          reject(new RuntimeUnavailable(event.data.message ?? ""));
        }
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        clearTimeout(timer);
        this.reset();
        reject(new RuntimeUnavailable(event.message || ""));
      };
      worker.postMessage({ type: "init", indexURL: PYODIDE_URL });
    });
    return this.ready;
  }

  run(code: string, tests: string): Promise<Output> {
    const next = this.queue.then(() => this.runNow(code, tests));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runNow(code: string, tests: string): Promise<Output> {
    let worker: Worker;
    try {
      worker = await this.warm();
    } catch (error) {
      return failure("error", "runtime-unavailable", detailOf(error));
    }

    return new Promise<Output>((resolve) => {
      const timer = setTimeout(() => {
        this.reset();
        resolve(failure("timeout", "timeout", null));
      }, RUNNER_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<{ type: string; output?: Output }>) => {
        if (event.data.type !== "result" || event.data.output === undefined) return;
        clearTimeout(timer);
        resolve(event.data.output);
      };
      worker.postMessage({ type: "run", code, tests });
    });
  }

  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}

const python = new PythonRuntime();

function run(request: RunnerRequest): void {
  const answer = (output: Output): void => {
    reply({
      type: "mindforge:result",
      runId: request.runId,
      status: output.status,
      reason: output.reason,
      results: [...output.results],
      message: output.message,
      logs: [...output.logs],
    });
  };

  // Not this page's language: answered, not ignored, so the app is not left
  // waiting for a clock — and never run here, under the wrong policy.
  if (!allowed.has(request.language)) {
    answer(failure("error", "runtime-unavailable", null));
    return;
  }

  if (request.language === "python") {
    // Nothing to transpile: Python's own compiler runs in the worker, and a
    // syntax error comes back from there as a `code-syntax` with its line number.
    void python.run(request.code, request.tests).then(answer);
    return;
  }

  let code: string;
  let tests: string;
  try {
    code = compile(request.code, request.language);
  } catch (error) {
    return answer(failure("error", "code-syntax", detailOf(error)));
  }
  try {
    tests = compile(request.tests, request.language);
  } catch (error) {
    return answer(failure("error", "tests-syntax", detailOf(error)));
  }

  const worker = new Worker(workerUrl);
  let settled = false;
  const finish = (): boolean => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    worker.terminate();
    return true;
  };

  const timer = setTimeout(() => {
    if (finish()) answer(failure("timeout", "timeout", null));
  }, RUNNER_TIMEOUT_MS);

  worker.onmessage = (event: MessageEvent<HarnessOutput>) => {
    if (finish()) answer(event.data);
  };
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault();
    if (finish()) answer(failure("error", "crashed", event.message || null));
  };

  worker.postMessage({ code, tests });
}

/** The raw text of an error, or null when there is none worth showing. */
function detailOf(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  return text === "" ? null : text;
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  // Both checks, not either. The origin says who sent it; the source says it is
  // the window that framed us rather than some other frame of the same origin.
  if (event.origin !== appOrigin || event.source !== window.parent) return;

  if (RunnerWarmSchema.safeParse(event.data).success) {
    // Only on the page that runs Python; the JavaScript page has no interpreter to
    // start and no policy that would let it fetch one. A warm-up that fails is
    // reported by the run that follows it, not here.
    if (allowed.has("python")) python.warm().catch(() => undefined);
    return;
  }

  const request = RunnerRequestSchema.safeParse(event.data);
  if (!request.success) return;

  run(request.data);
});

reply({ type: "mindforge:ready" });
