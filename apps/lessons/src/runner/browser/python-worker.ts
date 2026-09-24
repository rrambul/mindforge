/**
 * The Python worker: Pyodide, started once and kept warm (Phase 5).
 *
 * Unlike the JavaScript worker, this one is not thrown away after each run.
 * Starting CPython-on-WebAssembly takes seconds, and paying that on every press of
 * "Run tests" would make Python exercises the slow kind. State does not leak
 * between runs anyway: the harness builds a fresh `solution` module and a fresh
 * test namespace each time. When a run times out the client terminates this
 * worker, and the next run starts a new one — the one case where a warm runtime
 * cannot be trusted, because a loop is still spinning in it.
 *
 * Everything the learner or the agent wrote executes here, as in the JavaScript
 * worker, never on the frame's main thread.
 */

declare const __PYTHON_HARNESS__: string;

interface PyProxy {
  (...args: unknown[]): unknown;
  destroy(): void;
}

interface Pyodide {
  runPython(code: string): unknown;
  globals: { get(name: string): PyProxy };
}

declare function importScripts(...urls: string[]): void;
declare function loadPyodide(options: { indexURL: string }): Promise<Pyodide>;

declare const self: {
  onmessage: ((event: { readonly data: Message }) => void) | null;
  postMessage(message: unknown): void;
};

type Message =
  | { readonly type: "init"; readonly indexURL: string }
  | { readonly type: "run"; readonly code: string; readonly tests: string };

let runtime: Promise<Pyodide> | null = null;

async function start(indexURL: string): Promise<Pyodide> {
  // Classic `importScripts`, then Pyodide imports its own module core from the
  // same versioned directory on the lessons origin. Nothing comes from a CDN.
  importScripts(`${indexURL}pyodide.js`);
  const pyodide = await loadPyodide({ indexURL });
  pyodide.runPython(__PYTHON_HARNESS__);
  return pyodide;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

self.onmessage = (event) => {
  const message = event.data;

  if (message.type === "init") {
    runtime ??= start(message.indexURL);
    runtime.then(
      () => self.postMessage({ type: "ready" }),
      (error: unknown) => self.postMessage({ type: "failed", message: messageOf(error) }),
    );
    return;
  }

  void (async () => {
    try {
      if (runtime === null) {
        self.postMessage({
          type: "result",
          output: {
            status: "error",
            reason: "runtime-unavailable",
            results: [],
            message: null,
            logs: [],
          },
        });
        return;
      }
      const run = (await runtime).globals.get("run");
      try {
        const output = JSON.parse(String(run(message.code, message.tests))) as unknown;
        self.postMessage({ type: "result", output });
      } finally {
        run.destroy();
      }
    } catch (error) {
      // The harness answers every failure it can name; reaching here is the
      // interpreter itself failing, reported as a crash with its raw text.
      self.postMessage({
        type: "result",
        output: {
          status: "error",
          reason: "crashed",
          results: [],
          message: messageOf(error),
          logs: [],
        },
      });
    }
  })();
};

// A module, so its `declare`s stay its own rather than colliding with the other worker's.
export {};
