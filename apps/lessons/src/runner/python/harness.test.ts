import { RESULTS_MAX } from "@mindforge/core";
import { describe, expect, test } from "bun:test";

/**
 * The Python harness, under a real CPython (Phase 5).
 *
 * `harness.py` is the file Pyodide runs in the browser; it uses the standard
 * library only, so the system `python3` runs it identically and these tests need
 * no browser. What they cannot show — that it loads inside Pyodide, in a sandboxed
 * frame, under the runner's CSP — is `apps/web/e2e/exercise.spec.ts`'s job.
 */

const HARNESS_DIR = import.meta.dir;
const PYTHON = Bun.which("python3");

interface Output {
  readonly status: string;
  readonly reason: string | null;
  readonly results: readonly { name: string; passed: boolean; message: string | null }[];
  readonly message: string | null;
  readonly logs: readonly string[];
}

async function run(code: string, tests: string): Promise<Output> {
  const proc = Bun.spawn(
    [
      PYTHON!,
      "-c",
      "import json, sys; sys.path.insert(0, sys.argv[1]); import harness; " +
        "args = json.load(sys.stdin); print(harness.run(args['code'], args['tests']))",
      HARNESS_DIR,
    ],
    { stdin: new Blob([JSON.stringify({ code, tests })]), stdout: "pipe", stderr: "pipe" },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) throw new Error(err);
  return JSON.parse(out) as Output;
}

const SOLUTION = "def add(a, b):\n    return a + b\n";

describe.skipIf(PYTHON === null)("the Python harness", () => {
  test("runs every test function, in the order it was defined, named for a person", async () => {
    const output = await run(
      SOLUTION,
      [
        "from solution import add",
        "def test_adds_small_numbers():",
        "    assert add(1, 2) == 3",
        "def test_adds_negatives():",
        "    assert add(-1, -1) == -2",
      ].join("\n"),
    );

    expect(output).toEqual({
      status: "completed",
      reason: null,
      results: [
        { name: "adds small numbers", passed: true, message: null },
        { name: "adds negatives", passed: true, message: null },
      ],
      message: null,
      logs: [],
    });
  });

  test("fails a bare assert with the line that failed, and a messaged one with its message", async () => {
    const output = await run(
      SOLUTION,
      [
        "from solution import add",
        "def test_bare():",
        "    assert add(1, 1) == 3",
        "def test_messaged():",
        "    assert add(0, 0) == 1, 'zero plus zero is not one'",
      ].join("\n"),
    );

    expect(output.results).toEqual([
      { name: "bare", passed: false, message: "assertion failed: assert add(1, 1) == 3" },
      { name: "messaged", passed: false, message: "zero plus zero is not one" },
    ]);
  });

  test("fails a test that raises, naming the exception", async () => {
    const output = await run(
      "def lookup(d):\n    return d['x']\n",
      "from solution import lookup\ndef test_x():\n    lookup({})\n",
    );

    expect(output.results[0]).toEqual({ name: "x", passed: false, message: "KeyError: 'x'" });
  });

  test("reports the learner's syntax error with its line, as a load error", async () => {
    const output = await run("def add(a, b)\n    return a + b\n", "def test_x():\n    pass\n");

    // The key is the app's to word; the line and the compiler's own text are the detail.
    expect(output).toMatchObject({ status: "error", reason: "code-syntax" });
    expect(output.message).toMatch(/^line 1: /u);
  });

  test("reports code that raises while loading, and tests that do", async () => {
    expect(await run("raise ValueError('nope')", "def test_x(): pass")).toMatchObject({
      reason: "code-load",
      message: "ValueError: nope",
    });
    const tests = await run(SOLUTION, "from solution import missing");
    expect(tests.reason).toBe("tests-load");
    expect(tests.message).toMatch(/^ImportError: /u);
  });

  test("treats tests that define nothing as an error, not a pass", async () => {
    const output = await run(SOLUTION, "x = 1\n");

    expect(output).toMatchObject({ status: "error", reason: "nothing-registered", message: null });
  });

  test("refuses more tests than one run reports, before running any", async () => {
    const tests = Array.from(
      { length: RESULTS_MAX + 1 },
      (_, i) => `def test_${i}():\n    assert True\n`,
    ).join("");
    const output = await run(SOLUTION, tests);

    expect(output).toMatchObject({
      status: "error",
      reason: "too-many-tests",
      results: [],
      message: `${RESULTS_MAX + 1}`,
    });
  });

  test("a syntax error in the tests is the lesson's, and says so", async () => {
    const output = await run(SOLUTION, "def test_x(:\n    pass\n");

    expect(output).toMatchObject({ status: "error", reason: "tests-syntax" });
  });

  test("does not run a function the tests only imported", async () => {
    // A helper named `test_…` in the learner's module is not one of the tests.
    const output = await run(
      "def test_helper():\n    raise RuntimeError('should not run')\n",
      "from solution import test_helper\ndef test_real():\n    pass\n",
    );

    expect(output.results.map((r) => r.name)).toEqual(["real"]);
  });

  test("captures print, including a line with no newline at the end, and caps it", async () => {
    const output = await run(
      "import sys\nprint('hello')\nsys.stdout.write('no newline')\nfor i in range(150):\n    print(i)\n",
      "def test_x():\n    pass\n",
    );

    expect(output.logs[0]).toBe("hello");
    expect(output.logs).toHaveLength(100);
  });

  test("builds a fresh solution each run, so one run's module cannot pass another's tests", async () => {
    // The worker keeps one interpreter warm between runs — so both runs happen in
    // one Python process here, which is the property that makes that safe.
    const proc = Bun.spawn(
      [
        PYTHON!,
        "-c",
        [
          "import json, sys; sys.path.insert(0, sys.argv[1]); import harness",
          "first = harness.run('value = 1\\n', 'from solution import value\\ndef test_v():\\n    assert value == 1\\n')",
          "second = harness.run('\\n', 'import solution\\ndef test_v():\\n    assert not hasattr(solution, \"value\")\\n')",
          "print(json.dumps([json.loads(first), json.loads(second)]))",
        ].join("; "),
        HARNESS_DIR,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [first, second] = JSON.parse(await new Response(proc.stdout).text()) as [Output, Output];

    expect(first.results[0]!.passed).toBe(true);
    expect(second.results[0]!.passed).toBe(true);
  });
});
