import type { ReindexLearnerMemory, ReindexWorkspace, TeachRuns } from "@mindforge/api/teach";
import { FixedClock } from "@mindforge/core";
import {
  isExcludedFromSync,
  storageEtag,
  type BriefingKind,
  type FileState,
} from "@mindforge/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent, AgentGateway } from "./agent.port.js";
import type { LlmCallSink, RecordedCall } from "./llm-call.port.js";
import type { MemorySync } from "./memory-sync.js";
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
  walkUnder(prefix: string) {
    // Unfiltered, unlike `walk`. `.memory` belongs to the learner rather than to
    // a mission, so it is excluded from the sync-back walk and read explicitly.
    return Promise.resolve(
      [...this.files.entries()]
        .filter(([path]) => path.startsWith(`${prefix}/`))
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
  options: {
    writes?: Writes;
    throwAtEnd?: boolean;
    indexWarnings?: readonly { code: string; args?: Record<string, unknown> }[];
    finishRejects?: boolean;
    /**
     * Somebody else writing while the agent has the workspace.
     *
     * Applied mid-transcript rather than before `execute`, because that is what
     * makes it a conflict: written earlier it is simply the baseline, and
     * materialize would download it.
     */
    concurrentWrite?: readonly (readonly [string, string])[];
  } = {},
) {
  const storage = new Map<string, Uint8Array>([[`${PREFIX}/MISSION.md`, bytes("# Mission")]]);
  const disk = new FakeDisk();
  const recorded: RecordedCall[] = [];
  const finished: { status: string; error: string | null; result?: unknown }[] = [];
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
          for (const [path, content] of options.concurrentWrite ?? []) {
            storage.set(`${PREFIX}/${path}`, bytes(content));
          }
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
    (
      _userId: string,
      _runId: string,
      outcome: { status: string; error: string | null; result?: unknown },
    ) => {
      finished.push(outcome);
      return options.finishRejects
        ? Promise.reject(new Error("This run has already finished."))
        : Promise.resolve({} as never);
    },
  );
  const runs = { heartbeat, finish } as unknown as TeachRuns;

  // A double rather than the real one: the reindexer is the API's, tested against
  // real Postgres there. What this file needs from it is that the loop calls it
  // after the sync and folds its warnings into the run result — the parsing is
  // somebody else's suite.
  const indexed: { files: string[] }[] = [];
  const reindex = {
    execute: (input: { files: ReadonlyMap<string, Uint8Array> }) => {
      indexed.push({ files: [...input.files.keys()] });
      return Promise.resolve({
        lessons: 1,
        referenceDocs: 0,
        records: 0,
        warnings: options.indexWarnings ?? [],
      });
    },
  } as unknown as ReindexWorkspace;

  // Memory is per-user rather than per-mission and has its own Storage prefix,
  // so it is doubled here and proved by its own suite. What this file checks is
  // that the loop mounts it before the agent runs and syncs it after.
  const memoryWrites: string[][] = [];
  const materializeMemory = vi.fn(() => Promise.resolve({ baseline: [] }));
  const syncMemoryBack = vi.fn(() => Promise.resolve({ written: [], deleted: [] }));
  const memory = {
    materialize: materializeMemory,
    syncBack: syncMemoryBack,
  } as unknown as MemorySync;
  const reindexMemory = {
    execute: vi.fn((memoryInput: { files: ReadonlyMap<string, Uint8Array> }) => {
      memoryWrites.push([...memoryInput.files.keys()]);
      return Promise.resolve({ indexed: 0, superseded: 0, warnings: [] });
    }),
  } as unknown as ReindexLearnerMemory;

  const teach = new TeachRun(
    agent,
    sink,
    new WorkspaceSync(gateway, new FixedClock(AT)),
    runs,
    reindex,
    memory,
    reindexMemory,
  );

  return {
    teach,
    storage,
    disk,
    recorded,
    finished,
    heartbeat,
    indexed,
    materializeMemory,
    syncMemoryBack,
    memoryWrites,
    kill: () => {
      alive = false;
    },
    execute: (kind: BriefingKind = "generate_lesson") =>
      teach.execute({
        runId: RUN,
        userId: USER,
        missionId: MISSION,
        workspaceKey: KEY,
        briefing: "# Briefing\n\nDue reviews: not tracked yet.\n",
        pluginDir: "/tmp/plugin",
        skillRef: SKILL,
        kind,
        timezone: "America/Sao_Paulo",
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

  it("mounts the learner's memory before the agent runs", async () => {
    // §7.6: memory spans every mission, so the agent sees it whichever workspace
    // it is teaching. Materialised before the run, not after — reading it is the
    // point.
    await h.execute();

    expect(h.materializeMemory).toHaveBeenCalledWith(USER, expect.anything());
  });

  it("syncs the memory back and indexes it", async () => {
    await h.execute();

    expect(h.syncMemoryBack).toHaveBeenCalled();
    expect(h.memoryWrites).toHaveLength(1);
  });

  it("reindexes after the sync, not before", async () => {
    // Storage is canonical, so a row must never point at a path that failed to
    // upload. The lesson the agent wrote has to be in the set the reindexer sees.
    await h.execute();

    expect(h.indexed).toHaveLength(1);
    expect(h.indexed[0]?.files).toContain("lessons/0001-closures.html");
  });

  it("does not offer the briefing to the reindexer", async () => {
    // Excluded at the walk, so it is not in Storage and not in the index either —
    // a `lessons`-style row for Mindforge's own scaffolding would be a library
    // entry nobody wrote.
    await h.execute();

    expect(h.indexed[0]?.files).not.toContain("BRIEFING.md");
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
  it("is a success, and records which files were contested", async () => {
    // §7.4: the work landed and both versions were kept. Calling it failed would
    // make the honest outcome look like the broken one, and push people toward
    // re-running — which makes more conflicts.
    const h = harness([INIT, call("req_1"), result()], {
      // A lesson too, so the no-lesson rule cannot mask the conflict.
      writes: [...WROTE_A_LESSON, ["MISSION.md", "# Mission, edited by the agent"]],
      concurrentWrite: [["MISSION.md", "# Mission, edited by somebody else"]],
    });
    const outcome = await h.execute();

    expect(outcome.status).toBe("succeeded_with_conflicts");
    expect(h.finished.at(-1)?.status).toBe("succeeded_with_conflicts");
    expect((h.finished.at(-1)?.result as { conflicts?: { path: string }[] }).conflicts).toEqual([
      { path: "MISSION.md", reason: "changed_in_storage" },
    ]);
  });
});

describe("what the run reports back", () => {
  it("carries the reindexer's warnings, so a partial index is visible", async () => {
    // §7.4's degradation rule is "stored, partially indexed" — which is only
    // useful if the partiality reaches somebody. Warnings are stable keys plus
    // ICU args rather than prose, because the run screen renders in pt-BR too.
    const h = harness([INIT, call("req_1"), result()], {
      writes: WROTE_A_LESSON,
      indexWarnings: [{ code: "filename_unnumbered", args: { filename: "closures.html" } }],
    });

    await h.execute();

    expect((h.finished.at(-1)?.result as { warnings?: { code: string }[] }).warnings).toEqual([
      { code: "filename_unnumbered", args: { filename: "closures.html" } },
    ]);
  });

  it("does not crash the worker when the run was already finished", async () => {
    // The reaper may have given up on it while the agent was still going. That is
    // a legal outcome — the mission has moved on — rather than something to take
    // the process down over.
    const h = harness([INIT, call("req_1"), result()], { writes: [], finishRejects: true });

    await expect(h.execute()).resolves.toMatchObject({ status: "failed" });
    expect(h.disk.disposed).toBe(true);
  });
});

/**
 * What counts as having done the job, per agent.
 *
 * The first real curriculum run this project dispatched wrote `CURRICULUM.md`,
 * synced it, and was recorded as a failure — because the verdict asked every run
 * for a lesson and a curriculum run writes none by design. The tracks were on
 * disk and ready to index; nothing indexed them, because the run had "failed".
 */
describe("a curriculum run is judged on a curriculum", () => {
  it("succeeds when it wrote one, having written no lessons at all", async () => {
    const h = harness([INIT, call("req_1"), result()], {
      writes: [["CURRICULUM.md", "# Curriculum\n\n## Tracks\n"]],
    });

    expect((await h.execute("generate_curriculum")).status).toBe("succeeded");
  });

  it("fails when it wrote everything except the curriculum", async () => {
    // The same stall class the lesson verdict catches: a run that researched,
    // tidied and stopped. `NOTES.md` is where the skill is told to put its
    // questions, so a run that only wrote one has asked and given up.
    const h = harness([INIT, call("req_1"), result()], {
      writes: [["NOTES.md", "## Curriculum questions"]],
    });

    const outcome = await h.execute("generate_curriculum");

    expect(outcome.status).toBe("failed");
    expect(h.finished.at(-1)?.error).toContain("without writing a curriculum");
  });

  it("does not accept a curriculum in place of a lesson", async () => {
    // The pair. A teach run is told CURRICULUM.md is an input it must never
    // write, so one that produced it and no lesson has done the wrong job twice.
    const h = harness([INIT, call("req_1"), result()], {
      writes: [["CURRICULUM.md", "# Curriculum\n"]],
    });

    expect((await h.execute("generate_lesson")).status).toBe("failed");
  });
});
