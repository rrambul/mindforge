import { expect as bunExpect, describe, test } from "bun:test";

import { RESULTS_MAX } from "@mindforge/core";

import { deepEqual, format, RESULTS_MAX as HARNESS_RESULTS_MAX, runHarness } from "./harness.js";

/**
 * The harness, driven the way the worker drives it: CommonJS strings in, a result
 * out. The client transpiles before posting, so these inputs are written as the
 * transpiled form — `require("./solution")` rather than `import`.
 *
 * What matters most is that the learner's most common states — a failing test, a
 * typo that stops the code loading, a test file that registers nothing — each
 * come back as an answer they can act on rather than as a crash.
 */

const run = (code: string, tests: string) => runHarness({ code, tests });

const ADD = "exports.add = (a, b) => a + b;";
const USE = 'const { add } = require("./solution");\n';

describe("running tests", () => {
  test("a passing and a failing test each report what happened", async () => {
    const output = await run(
      ADD,
      USE +
        `test("adds", () => expect(add(1, 2)).toBe(3));
         test("adds wrongly", () => expect(add(1, 2)).toBe(4));`,
    );

    bunExpect(output.status).toBe("completed");
    bunExpect(output.results).toEqual([
      { name: "adds", passed: true, message: null },
      { name: "adds wrongly", passed: false, message: "expected 3 to be 4" },
    ]);
  });

  test("async tests are awaited, and a rejection fails the test", async () => {
    const output = await run(
      "exports.later = (v) => new Promise((r) => setTimeout(() => r(v), 5));",
      `const { later } = require("./solution");
       test("resolves", async () => expect(await later(2)).toBe(2));
       test("rejects", async () => { await later(1); throw new Error("nope"); });`,
    );

    bunExpect(output.results.map((r) => r.passed)).toEqual([true, false]);
    bunExpect(output.results[1]!.message).toBe("Error: nope");
  });

  test("describe prefixes names, and it is an alias of test", async () => {
    const output = await run(
      ADD,
      USE + `describe("add", () => { it("works", () => expect(add(2, 2)).toBe(4)); });`,
    );

    bunExpect(output.results[0]!.name).toBe("add › works");
  });

  test("module.exports reassigned is what the tests import", async () => {
    // `export default` and `module.exports = fn` both land here after the
    // transpile, and the tests must see the replacement rather than `{}`.
    const output = await run(
      "module.exports = { double: (n) => n * 2 };",
      `const { double } = require("./solution"); test("x", () => expect(double(4)).toBe(8));`,
    );

    bunExpect(output.results[0]!.passed).toBe(true);
  });

  test("tests run one after another, not interleaved", async () => {
    const output = await run(
      "exports.log = [];",
      `const { log } = require("./solution");
       test("a", async () => { log.push("a1"); await null; log.push("a2"); });
       test("b", () => { log.push("b"); expect(log).toEqual(["a1", "a2", "b"]); });`,
    );

    bunExpect(output.results.every((r) => r.passed)).toBe(true);
  });
});

describe("what the tests may import", () => {
  test.each(["./solution", "./solution.js", "./solution.ts"])(
    "%s is the learner's code",
    async (specifier) => {
      const output = await run(
        ADD,
        `const { add } = require("${specifier}"); test("x", () => expect(add(1, 1)).toBe(2));`,
      );

      bunExpect(output.results[0]!.passed).toBe(true);
    },
  );

  test("anything else is refused while the tests load, naming what was asked for", async () => {
    const output = await run(ADD, `require("fs"); test("x", () => {});`);

    // A key the app translates, and the specifier as the detail — no sentence of ours.
    bunExpect(output).toMatchObject({ status: "error", reason: "import-refused", message: "fs" });
  });

  test("the learner's code may import nothing at all", async () => {
    const output = await run(`require("./solution");`, `test("x", () => {});`);

    bunExpect(output).toMatchObject({
      status: "error",
      reason: "import-refused",
      message: "./solution",
    });
  });
});

describe("states that are not a crash", () => {
  test("code that throws while loading says so, with no results", async () => {
    const output = await run("throw new TypeError('bad');", `test("x", () => {});`);

    bunExpect(output).toMatchObject({
      status: "error",
      reason: "code-load",
      results: [],
      message: "TypeError: bad",
    });
  });

  test("tests that throw while loading say so", async () => {
    const output = await run(ADD, `undefinedThing();`);

    bunExpect(output).toMatchObject({ status: "error", reason: "tests-load" });
    bunExpect(output.message).toStartWith("ReferenceError");
  });

  test("code that does not parse is a syntax error, not a load error", async () => {
    // Normally caught by the client's transpile; a body that parses there and not
    // here still has to say which it was.
    const output = await run("return )", `test("x", () => {});`);

    bunExpect(output).toMatchObject({ status: "error", reason: "code-syntax" });
    bunExpect(output.message).toStartWith("SyntaxError");
  });

  test("tests that register nothing are an error, not an empty pass", async () => {
    // An empty suite would otherwise be "every test passed", which is true and
    // proves nothing — the same rule `attemptPassed` holds in core.
    const output = await run(ADD, "// no tests");

    bunExpect(output).toMatchObject({
      status: "error",
      reason: "nothing-registered",
      message: null,
    });
  });

  test("more tests than one run reports is an error up front, not a reply the app throws away", async () => {
    // The app parses replies against `RESULTS_MAX`; a longer one would be dropped
    // and read as a timeout — correct code told to "look for a loop".
    const output = await run(
      ADD,
      `for (let i = 0; i <= ${RESULTS_MAX}; i++) test("t" + i, () => expect(add(i, 0)).toBe(i));`,
    );

    bunExpect(output).toMatchObject({
      status: "error",
      reason: "too-many-tests",
      results: [],
      message: `${RESULTS_MAX + 1}`,
    });
  });

  test("exactly the limit still runs", async () => {
    const output = await run(
      ADD,
      `for (let i = 0; i < ${RESULTS_MAX}; i++) test("t" + i, () => expect(add(i, 0)).toBe(i));`,
    );

    bunExpect(output.status).toBe("completed");
    bunExpect(output.results).toHaveLength(RESULTS_MAX);
  });
});

describe("console capture", () => {
  test("logs from the code and the tests are captured, levels marked", async () => {
    const output = await run(
      'console.log("loaded", { a: 1 });',
      `console.warn("careful"); test("x", () => console.error("inside"));`,
    );

    bunExpect(output.logs).toEqual(["loaded { a: 1 }", "[warn] careful", "[error] inside"]);
  });

  test("capture is capped, so a logging loop cannot flood the answer", async () => {
    const output = await run(
      ADD,
      `for (let i = 0; i < 500; i++) console.log("x".repeat(5000)); test("x", () => {});`,
    );

    bunExpect(output.logs).toHaveLength(100);
    bunExpect(output.logs[0]!.length).toBe(1000);
  });
});

describe("expect", () => {
  /** Run one assertion as a test and return its message, or null on a pass. */
  const check = async (assertion: string): Promise<string | null> => {
    const output = await run("", `test("x", async () => { ${assertion} });`);
    bunExpect(output.status).toBe("completed");
    return output.results[0]!.message;
  };

  test.each([
    "expect(1).toBe(1)",
    "expect(NaN).toBe(NaN)",
    "expect({ a: [1, { b: 2 }] }).toEqual({ a: [1, { b: 2 }] })",
    "expect(new Map([[1, 'a']])).toEqual(new Map([[1, 'a']]))",
    "expect(new Set([1, 2])).toEqual(new Set([2, 1]))",
    "expect(new Date(0)).toEqual(new Date(0))",
    "expect(1).not.toBe(2)",
    "expect({ a: 1 }).not.toEqual({ a: 2 })",
    "expect('x').toBeTruthy()",
    "expect(0).toBeFalsy()",
    "expect(null).toBeNull()",
    "expect(undefined).toBeUndefined()",
    "expect(0).toBeDefined()",
    "expect([1, 2]).toContain(2)",
    "expect([{ a: 1 }]).toContain({ a: 1 })",
    "expect('hello').toContain('ell')",
    "expect(new Set([3])).toContain(3)",
    "expect([1, 2, 3]).toHaveLength(3)",
    "expect('abc').toMatch(/b/)",
    "expect('abc').toMatch('bc')",
    "expect(2).toBeGreaterThan(1)",
    "expect(2).toBeGreaterThanOrEqual(2)",
    "expect(1).toBeLessThan(2)",
    "expect(2).toBeLessThanOrEqual(2)",
    "expect(0.1 + 0.2).toBeCloseTo(0.3)",
    "expect(() => { throw new Error('boom'); }).toThrow()",
    "expect(() => { throw new Error('boom'); }).toThrow('oo')",
    "expect(() => { throw new Error('boom'); }).toThrow(/^boom$/)",
    "expect(() => { throw 'plain'; }).toThrow('plain')",
    "expect(() => 1).not.toThrow()",
    "await expect(Promise.resolve(3)).resolves.toBe(3)",
    "await expect(Promise.reject(new Error('no'))).rejects.toThrow('no')",
    "await expect(Promise.resolve(3)).resolves.not.toBe(4)",
  ])("passes: %s", async (assertion) => {
    bunExpect(await check(assertion)).toBeNull();
  });

  test.each([
    ["expect(3).toBe(4)", "expected 3 to be 4"],
    ["expect('a').toBe('b')", 'expected "a" to be "b"'],
    ["expect({ a: 1 }).toEqual({ a: 2 })", "expected { a: 1 } to equal { a: 2 }"],
    ["expect([1]).toEqual([1, 2])", "expected [1] to equal [1, 2]"],
    ["expect(1).not.toBe(1)", "expected 1 not to be 1"],
    ["expect([1, 2]).toHaveLength(3)", "expected length to be 3, but it was 2"],
    ["expect(5).toHaveLength(1)", "expected 5 to have a length"],
    ["expect('x').toBeGreaterThan(1)", 'toBeGreaterThan needs a number, but got "x"'],
    ["expect(() => 1).toThrow()", "expected it to throw, but it didn't throw"],
    [
      "expect(() => { throw new Error('boom'); }).toThrow('bang')",
      'expected it to throw matching "bang", but it threw: boom',
    ],
    [
      "expect(() => { throw new Error('boom'); }).not.toThrow()",
      "expected it not to throw, but it threw: boom",
    ],
    ["expect(1).toThrow()", "toThrow needs a function to call, but got 1"],
    [
      "await expect(Promise.resolve(1)).rejects.toThrow()",
      "expected a rejection, but it resolved to 1",
    ],
    [
      "await expect(Promise.reject(new Error('no'))).resolves.toBe(1)",
      "expected it to resolve, but it rejected: Error: no",
    ],
  ])("fails: %s", async (assertion, message) => {
    bunExpect(await check(assertion)).toBe(message);
  });
});

describe("deepEqual and format", () => {
  test("types that look alike are still different", () => {
    bunExpect(deepEqual([], {})).toBe(false);
    bunExpect(deepEqual(new Date(0), 0)).toBe(false);
    bunExpect(deepEqual(new Map(), new Set())).toBe(false);
    bunExpect(deepEqual({ a: undefined }, { b: undefined })).toBe(false);
    bunExpect(deepEqual(/a/g, /a/g)).toBe(true);
  });

  test("a cycle does not recurse forever", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    const b: Record<string, unknown> = {};
    b["self"] = b;

    bunExpect(deepEqual(a, b)).toBe(true);
    bunExpect(format(a)).toBe("{ self: [Circular] }");
  });

  test("values read the way a learner would write them, and stay one line", () => {
    bunExpect(format(-0)).toBe("-0");
    bunExpect(format(10n)).toBe("10n");
    bunExpect(format(function named() {})).toBe("[Function named]");
    bunExpect(format(new Map([["k", 1]]))).toBe('Map {"k" => 1}');
    bunExpect(format(new Error("x"))).toBe("Error: x");
    bunExpect(format("x".repeat(500)).length).toBe(120);
  });
});

test("the harness's result cap is core's, so the app never rejects a reply the harness allowed", () => {
  bunExpect(HARNESS_RESULTS_MAX).toBe(RESULTS_MAX);
});
