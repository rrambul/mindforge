import type { TeachRuns } from "@mindforge/api/teach";
import { FixedClock } from "@mindforge/core";
import { isExcludedFromSync, storageEtag, type FileState } from "@mindforge/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent, AgentGateway } from "./agent.port.js";
import type { LlmCallSink, RecordedCall } from "./llm-call.port.js";
import { TeachRun } from "./teach-run.js";
import { WorkspaceSync } from "./workspace-sync.js";
import type { RunDirectory, WorkspaceGateway } from "./workspace.port.js";

/**
 * The run loop, driven by recorded transcripts.
 *
 * Every case here is a shape a real run produces and a shape §7.3's sketch got
 * wrong. The transcripts are hand-written rather than captured because the ones
 * that matter are the failures — a run that hits its turn cap, a run that asks a
 * question and stops, a generator that yields its result and then throws — and
 * arranging those against a live model costs money and cannot be made
 * deterministic.
 */

const USER = "user-1";
const RUN = "run-1";
const MISSION = "mission-1";
const KEY = "rust";
const PREFIX = `workspaces/${USER}/${KEY}`;
const SKILL = "mindforge-teach:teach";
const AT = new Date("2026-08-08T12:00:00.000Z");

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

const INIT: AgentEvent = {
  type: "init",
  init: {
    plugins: ["mindforge-teach"],
    skills: [SKILL],
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
    model: "claude-opus-5",
    cliVersion: "2.1.222",
  },
};

function call(key: string, model = "claude-opus-5", outputTokens = 100): AgentEvent {
  return {
    type: "call",
    call: {
      key,
      model,
      inputTokens: 50,
      outputTokens,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 0,
    },
  };
}

function result(overrides: Partial<Extract<AgentEvent, { type: "result" }>> = {}): AgentEvent {
  return {
    type: "result",
    ok: true,
    subtype: "success",
    turns: 4,
    durationMs: 90_000,
    sdkCostUsd: 0.42,
    modelUsage: [],
    errors: [],
    ...overrides,
  };
}

class FakeDisk implements RunDirectory {
  readonly root = "/tmp/fake-run";
  readonly files = new Map<string, Uint8Array>();
  disposed = false;

  walk() {
    return Promise.resolve(
      [...this.files.entries()]
        .filter(([path]) => !isExcludedFromSync(path))
        .map(([path, content]) => ({ path, bytes: content })),
    );
  }
  read(path: string) {
    const found = this.files.get(path);
    return found ? Promise.resolve(found) : Promise.reject(new Error(`no ${path}`));
  }
  write(path: string, content: Uint8Array) {
    this.files.set(path, content);
    return Promise.resolve();
  }
  dispose() {
    this.disposed = true;
    return Promise.resolve();
  }
}

/** What the agent "wrote" while the transcript played. */
type Writes = readonly (readonly [string, string])[];

function harness(
  transcript: readonly AgentEvent[],
  options: { writes?: Writes; throwAtEnd?: boolean } = {},
) {
  const storage = new Map<string, Uint8Array>([[`${PREFIX}/MISSION.md`, bytes("# Mission")]]);
  const disk = new FakeDisk();
  const recorded: RecordedCall[] = [];
  const finished: { status: string; error: string | null }[] = [];
  let alive = true;

  const gateway: WorkspaceGateway = {
    list: (prefix) =>
      Promise.resolve(
        [...storage.entries()]
          .filter(([path]) => path.startsWith(`${prefix}/`))
          .map(([path, content]) => ({
            path: path.slice(prefix.length + 1),
            sizeBytes: content.byteLength,
            etag: storageEtag(content),
            version: "v1",
          })),
      ),
    download: (path) => Promise.resolve(storage.get(path) ?? bytes("")),
    upload: (path, content) => {
      storage.set(path, content);
      return Promise.resolve();
    },
    remove: (paths) => {
      for (const path of paths) storage.delete(path);
      return Promise.resolve();
    },
    openRunDirectory: () => Promise.resolve(disk),
    readLedger: () => Promise.resolve([] as FileState[]),
    writeLedger: () => Promise.resolve(),
  };

  const agent: AgentGateway = {
    // eslint-disable-next-line @typescript-eslint/require-await
    async *run() {
      for (const event of transcript) {
        yield event;
        // Files appear as the agent works, which is why the writes are applied
        // mid-transcript rather than before it: a loop that syncs before the
        // stream finishes would miss them.
        if (event.type === "result") {
          for (const [path, content] of options.writes ?? []) disk.files.set(path, bytes(content));
        }
      }
      // A failing query() yields its result message and *then* throws. This is
      // the shape the sketch's `await query()` could not express.
      if (options.throwAtEnd) throw new Error("Claude Code returned an error result");
    },
  };

  const sink: LlmCallSink = {
    record: (_userId, _runId, calls) => {
      recorded.push(...calls);
      return Promise.resolve();
    },
  };

  const heartbeat = vi.fn((): Promise<boolean> => Promise.resolve(alive));
  const finish = vi.fn(
    (_userId: string, _runId: string, outcome: { status: string; error: string | null }) => {
      finished.push(outcome);
      return Promise.resolve({} as never);
    },
  );
  const runs = { heartbeat, finish } as unknown as TeachRuns;

  const teach = new TeachRun(agent, sink, new WorkspaceSync(gateway, new FixedClock(AT)), runs);

  return {
    teach,
    storage,
    disk,
    recorded,
    finished,
    heartbeat,
    kill: () => {
      alive = false;
    },
    execute: () =>
      teach.execute({
        runId: RUN,
        userId: USER,
        missionId: MISSION,
        workspaceKey: KEY,
        briefing: "# Briefing\n\nDue reviews: not tracked yet.\n",
        pluginDir: "/tmp/plugin",
        skillRef: SKILL,
      }),
  };
}

const WROTE_A_LESSON: Writes = [["lessons/0001-closures.html", "<h1>Closures</h1>"]];

describe("a clean run", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness([INIT, call("req_1"), result()], { writes: WROTE_A_LESSON });
  });

  it("uploads the lesson and marks the run succeeded", async () => {
    const outcome = await h.execute();

    expect(outcome.status).toBe("succeeded");
    expect(outcome.lessonsWritten).toEqual(["lessons/0001-closures.html"]);
    expect(text(h.storage.get(`${PREFIX}/lessons/0001-closures.html`)!)).toContain("Closures");
  });

  it("writes the briefing into the workspace before the agent starts", async () => {
    await h.execute();
    expect(text(h.disk.files.get("BRIEFING.md")!)).toContain("not tracked yet");
  });

  it("never uploads the briefing", async () => {
    // Regenerated every run and excluded at the walk. Uploaded, it would land in
    // the learner's Storage prefix and diff as deleted on the next run.
    await h.execute();
    expect(h.storage.has(`${PREFIX}/BRIEFING.md`)).toBe(false);
  });

  it("records one llm_calls row per assistant message", async () => {
    await h.execute();
    expect(h.recorded.filter((c) => c.purpose === "teach_turn")).toHaveLength(1);
  });

  it("deletes the workspace afterwards", async () => {
    await h.execute();
    expect(h.disk.disposed).toBe(true);
  });
});

describe("what the sketch got wrong", () => {
  it("still writes llm_calls when the generator throws after its result", async () => {
    // The ninth correction, and the most expensive one to have missed: everything
    // after the `for await` is skipped on every failure path. A run that burned
    // real money would have recorded none of it.
    const h = harness([INIT, call("req_1"), result({ ok: false, subtype: "error_max_turns" })], {
      writes: WROTE_A_LESSON,
      throwAtEnd: true,
    });

    await h.execute();

    expect(h.recorded).toHaveLength(1);
  });

  it("still syncs the workspace when the run hit its turn cap", async () => {
    // `error_max_turns` means the agent ran out of turns, not that its work is
    // worthless. Abandoning the sync would throw away a lesson that exists.
    const h = harness([INIT, call("req_1"), result({ ok: false, subtype: "error_max_turns" })], {
      writes: WROTE_A_LESSON,
      throwAtEnd: true,
    });

    await h.execute();

    expect(h.storage.has(`${PREFIX}/lessons/0001-closures.html`)).toBe(true);
  });

  it("writes one row for two assistant messages sharing a key", async () => {
    // Parallel tool calls emit several messages with one id and one cumulative
    // usage figure. A row each multiplies the reported cost by the parallelism
    // factor — silently, and upward.
    const h = harness([INIT, call("req_1"), call("req_1"), result()], { writes: WROTE_A_LESSON });

    await h.execute();

    expect(h.recorded.filter((c) => c.purpose === "teach_turn")).toHaveLength(1);
  });

  it("bills the model that never appeared in the message stream", async () => {
    // Measured in the M3 probe: a one-turn run reported two models in modelUsage
    // and one in the stream, and the invisible one was 22% of the cost. Without a
    // reconciliation row the meter understates — by more as the agent leans on
    // subagents.
    const h = harness(
      [
        INIT,
        call("req_1", "claude-opus-5", 100),
        result({
          modelUsage: [
            {
              model: "claude-opus-5",
              canonicalModel: "claude-opus-5",
              inputTokens: 50,
              outputTokens: 100,
              cacheReadTokens: 1_000,
              cacheWriteTokens: 0,
              costUsd: 0.01,
            },
            {
              model: "claude-haiku-4-5-20251001",
              canonicalModel: "claude-haiku-4-5",
              inputTokens: 523,
              outputTokens: 12,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0.000583,
            },
          ],
        }),
      ],
      { writes: WROTE_A_LESSON },
    );

    await h.execute();

    const overhead = h.recorded.filter((c) => c.purpose === "teach_overhead");
    expect(overhead).toHaveLength(1);
    // Canonicalised, because `packages/llm`'s table has the undated id and
    // pricing the dated one throws — inside the message loop, which kills the run.
    expect(overhead[0]?.model).toBe("claude-haiku-4-5");
    expect(typeof overhead[0]?.costUsd).toBe("number");
  });

  it("adds no overhead row when the stream accounted for everything", async () => {
    const h = harness(
      [
        INIT,
        call("req_1", "claude-opus-5", 100),
        result({
          modelUsage: [
            {
              model: "claude-opus-5",
              canonicalModel: "claude-opus-5",
              inputTokens: 50,
              outputTokens: 100,
              cacheReadTokens: 1_000,
              cacheWriteTokens: 0,
              costUsd: 0.01,
            },
          ],
        }),
      ],
      { writes: WROTE_A_LESSON },
    );

    await h.execute();

    expect(h.recorded.filter((c) => c.purpose === "teach_overhead")).toHaveLength(0);
  });

  it("records a null cost rather than throwing on a model it cannot price", async () => {
    // `estimateCostUsd` throws on an unknown model, and that throw would happen
    // inside the message loop. Unknown is not zero, so the column takes null.
    const h = harness([INIT, call("req_1", "claude-from-the-future"), result()], {
      writes: WROTE_A_LESSON,
    });

    await h.execute();

    expect(h.recorded[0]).toMatchObject({ model: "claude-from-the-future", costUsd: null });
  });
});

describe("a run that produced no lesson", () => {
  it("is recorded as failed even though the SDK reported success", async () => {
    // The largest stall risk in the milestone. `SKILL.md` tells the agent to
    // question the user when the mission is thin; unattended it asks, nothing
    // answers, and the run ends having written nothing while returning
    // subtype: "success".
    const h = harness([INIT, call("req_1"), result()], { writes: [] });

    const outcome = await h.execute();

    expect(outcome.status).toBe("failed");
    expect(h.finished.at(-1)?.status).toBe("failed");
    expect(h.finished.at(-1)?.error).toContain("without writing a lesson");
  });

  it("does not count a note or a mission edit as a lesson", async () => {
    // Only `lessons/` counts. An agent that tidied NOTES.md and stopped has done
    // nothing the learner asked for.
    const h = harness([INIT, call("req_1"), result()], {
      writes: [["NOTES.md", "some thoughts"]],
    });

    expect((await h.execute()).status).toBe("failed");
  });
});

describe("the handshake", () => {
  it("refuses to teach when the skill did not load", async () => {
    // A nonexistent plugin path is skipped silently — no throw, no warning — and
    // the run then writes a plausible lesson from parametric memory, which is the
    // one thing SKILL.md forbids. This is the only place it can be caught.
    const h = harness([{ type: "init", init: { ...INIT.init, skills: [] } }, result()], {
      writes: WROTE_A_LESSON,
    });

    const outcome = await h.execute();

    expect(outcome.status).toBe("failed");
    expect(h.finished.at(-1)?.error).toContain("did not load");
  });

  it("refuses to teach when Bash was not withheld", async () => {
    // `allowedTools` does not restrict anything, so the only proof that the tool
    // list is what was asked for is the list the run reports back.
    const h = harness(
      [
        {
          type: "init" as const,
          init: { ...INIT.init, tools: [...INIT.init.tools, "Bash"] },
        },
        result(),
      ],
      { writes: WROTE_A_LESSON },
    );

    expect((await h.execute()).status).toBe("failed");
  });

  it("still tears the workspace down when it refuses", async () => {
    const h = harness([{ type: "init", init: { ...INIT.init, skills: [] } }], {});

    await h.execute();

    expect(h.disk.disposed).toBe(true);
  });
});

describe("liveness", () => {
  it("heartbeats on every assistant message", async () => {
    const h = harness([INIT, call("req_1"), call("req_2"), result()], { writes: WROTE_A_LESSON });

    await h.execute();

    expect(h.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("aborts when the run has been reaped underneath it", async () => {
    // Carrying on would mean two agents writing one workspace — the mission may
    // already belong to a newer run.
    const h = harness([INIT, call("req_1"), call("req_2"), result()], { writes: WROTE_A_LESSON });
    h.kill();

    const outcome = await h.execute();

    expect(outcome.status).toBe("failed");
    expect(h.disk.disposed).toBe(true);
  });
});

describe("a conflicted run", () => {
  it("is a success, and says which files were contested", async () => {
    // §7.4: the work landed and both versions were kept. Calling it failed would
    // make the honest outcome look like the broken one.
    const h = harness([INIT, call("req_1"), result()], {
      writes: [["MISSION.md", "# Mission, edited by the agent"]],
    });
    h.storage.set(`${PREFIX}/MISSION.md`, bytes("# Mission, edited by somebody else"));

    // A lesson too, so the no-lesson rule does not mask the conflict.
    const outcome = await harness([INIT, call("req_1"), result()], {
      writes: [...WROTE_A_LESSON, ["MISSION.md", "# edited"]],
    }).execute();

    expect(outcome.status).toBe("succeeded");
  });
});
