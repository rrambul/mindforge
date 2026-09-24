/**
 * Building the runner's script, once per process.
 *
 * Three `Bun.build` calls and no build step: both workers are bundled first, and
 * their text is inlined into the client with `define`, because the client cannot
 * fetch them (on the JavaScript page `connect-src 'none'` forbids it) nor load them
 * by URL (the sandboxed frame's origin is opaque). Built on first request and memoised, so a process that never serves
 * the runner never pays for it, and `bun --watch` picks up an edit on restart.
 *
 * **Only the client may value-import `@mindforge/core`.** Two `Bun.build` calls
 * that each read core's source, in a process that has core loaded itself, fail
 * in Bun 1.3 with "Unseekable reading file" — every runner page a 500. The worker
 * bundles therefore take core's types only (erased) and mirror the one constant
 * they need; `handler.test.ts`'s real-bundle test runs with core loaded and is
 * what catches a regression.
 *
 * `conditions: ["bun"]` is what resolves `@mindforge/core` to its source, the same
 * reason `apps/lessons` reads core through that condition at runtime: without it
 * the bundle would need `packages/core/dist`, and the runner would stop building
 * the day nobody had run `pnpm build`.
 */

import { PYODIDE_VERSION } from "./pyodide.js";

const BROWSER_DIR = `${import.meta.dir}/browser`;

async function build(entry: string, define: Record<string, string> = {}): Promise<string> {
  const result = await Bun.build({
    entrypoints: [`${BROWSER_DIR}/${entry}`],
    target: "browser",
    // Classic scripts, never modules: a module script is fetched in CORS mode, and
    // from a sandboxed frame's opaque origin that would need CORS headers here.
    format: "iife",
    minify: true,
    conditions: ["bun"],
    define,
  });

  if (!result.success) {
    throw new Error(`runner bundle failed: ${result.logs.map((log) => log.message).join("; ")}`);
  }
  const [output] = result.outputs;
  if (output === undefined) throw new Error("runner bundle produced nothing");
  return output.text();
}

export interface RunnerScript {
  readonly text: string;
  /** A content hash, so the page can link `/runner.js?v=<version>` and the script can be cached hard. */
  readonly version: string;
}

let script: Promise<RunnerScript> | null = null;

/** The client bundle, with the worker inside it. Rejected builds are not cached. */
export function runnerScript(): Promise<RunnerScript> {
  script ??= (async () => {
    const worker = await build("worker.ts");
    const harness = await Bun.file(`${import.meta.dir}/python/harness.py`).text();
    const pythonWorker = await build("python-worker.ts", {
      __PYTHON_HARNESS__: JSON.stringify(harness),
    });
    const text = await build("client.ts", {
      __RUNNER_WORKER_SOURCE__: JSON.stringify(worker),
      __PYTHON_WORKER_SOURCE__: JSON.stringify(pythonWorker),
      __PYODIDE_VERSION__: JSON.stringify(PYODIDE_VERSION),
    });
    return { text, version: Bun.hash(text).toString(36) };
  })().catch((error: unknown) => {
    script = null;
    throw error;
  });

  return script;
}
