/**
 * Say why the process is ending, on stderr, synchronously.
 *
 * `enableShutdownHooks()` makes Nest catch SIGTERM and SIGINT, close the app, and
 * re-raise the signal. That is the right shutdown, and it is also silent: the
 * process ends with a non-zero status and not one line saying so. Under `node
 * --watch` that reads as "Failed running 'src/main.ts'" with nothing above it,
 * which is how the API went down three times in one day (2026-09-24) with no way
 * to tell a signal from a crash. In a container it would read as a restart
 * nobody can explain.
 *
 * Written with `writeSync` because pino flushes asynchronously and an exiting
 * process does not wait for it. A signal is only observed here, never handled:
 * adding a listener does not stop Nest's own from running.
 */

import { writeSync } from "node:fs";

const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT", "SIGUSR2"] as const;

interface ProcessLike {
  readonly pid: number;
  readonly ppid: number;
  on(event: "exit", listener: (code: number) => void): unknown;
  on(event: (typeof SIGNALS)[number], listener: () => void): unknown;
}

export function reportExit(
  target: ProcessLike,
  write = (line: string) => writeSync(2, line),
): void {
  for (const signal of SIGNALS) {
    target.on(signal, () => {
      write(
        `[api] received ${signal} (pid ${String(target.pid)}, parent ${String(target.ppid)})\n`,
      );
    });
  }
  target.on("exit", (code) => {
    write(`[api] exiting with code ${String(code)}\n`);
  });
}
