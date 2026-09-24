import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { reportExit } from "./report-exit.js";

function fakeProcess() {
  return Object.assign(new EventEmitter(), { pid: 42, ppid: 7 });
}

describe("reportExit", () => {
  it("names a shutdown signal and who the parent was, the moment it arrives", () => {
    const target = fakeProcess();
    const lines: string[] = [];
    reportExit(target, (line) => lines.push(line));

    target.emit("SIGTERM");

    expect(lines).toEqual(["[api] received SIGTERM (pid 42, parent 7)\n"]);
  });

  it("says the exit code, so a signal and a crash can be told apart", () => {
    const target = fakeProcess();
    const lines: string[] = [];
    reportExit(target, (line) => lines.push(line));

    target.emit("exit", 1);

    expect(lines).toEqual(["[api] exiting with code 1\n"]);
  });

  it("observes rather than handles: another listener on the signal still runs", () => {
    const target = fakeProcess();
    let nestShutdown = false;
    target.on("SIGINT", () => {
      nestShutdown = true;
    });
    reportExit(target, () => undefined);

    target.emit("SIGINT");

    expect(nestShutdown).toBe(true);
  });
});
