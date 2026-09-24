/**
 * The test harness an exercise runs under — `test`, `describe`, `expect`, and the
 * module shim that lets the tests `import` the learner's code.
 *
 * It runs **inside a Web Worker** in the runner frame (`browser/worker.ts`), never
 * on the frame's main thread: everything evaluated here was written by the learner
 * or by the agent, and a `while (true)` has to be something the frame can kill
 * rather than something that freezes the tab (TECH-DESIGN.md §7.5).
 *
 * Plain functions over plain data, with no DOM and no worker globals, so that
 * `bun test` exercises exactly the code the browser runs. The input is already
 * CommonJS — the client transpiles before posting — so this file never needs a
 * parser.
 *
 * It is deliberately small. It is not Jest: it is the handful of matchers an
 * exercise's tests actually reach for, with failure messages written for someone
 * learning rather than for a CI log.
 */

import type { RunReason } from "@mindforge/core";

/**
 * `RESULTS_MAX` in packages/core, mirrored rather than imported. This file is
 * bundled into the runner's worker, and a value import of core here made two
 * `Bun.build` calls read core's source in one process — which Bun 1.3 fails with
 * "Unseekable reading file" once the server has core loaded itself. A type import
 * is erased; this constant is the only value the harness needed, and
 * `harness.test.ts` asserts it still equals core's.
 */
export const RESULTS_MAX = 200;

export interface HarnessInput {
  /** The learner's code, as CommonJS. */
  readonly code: string;
  /** The exercise's tests, as CommonJS. */
  readonly tests: string;
}

export interface HarnessResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string | null;
}

/**
 * `timeout` is not here: the harness cannot notice its own infinite loop. The
 * client owns the clock and kills the worker.
 */
export interface HarnessOutput {
  readonly status: "completed" | "error";
  /**
   * Why it did not complete, as a key the app words (§5.2). `message` is only the
   * raw detail beneath it — the exception's own text, the refused specifier — never
   * a sentence of ours, which a pt-BR learner would read in English.
   */
  readonly reason: RunReason | null;
  readonly results: readonly HarnessResult[];
  readonly message: string | null;
  readonly logs: readonly string[];
}

const LOG_LINES_MAX = 100;
const LOG_LINE_CHARS = 1_000;
const MESSAGE_CHARS = 4_000;
const NAME_CHARS = 500;
const VALUE_CHARS = 120;

/** The specifiers that name the learner's code. Anything else is refused. */
const SOLUTION_SPECIFIERS = new Set(["./solution", "./solution.js", "./solution.ts"]);

/**
 * `require` of anything but `./solution`. Its message is the specifier alone: the
 * app words the refusal, and inside a test body the result's message reads as the
 * data it is (`ImportRefused: fs`) rather than as English prose.
 */
class ImportRefused extends Error {
  override readonly name = "ImportRefused";

  constructor(readonly specifier: string) {
    super(specifier);
  }
}

// ============================================================================
// Running
// ============================================================================

export async function runHarness(input: HarnessInput): Promise<HarnessOutput> {
  const logs = createLogs();

  const solution = { exports: {} as Record<string, unknown> };
  try {
    evaluate(input.code, {
      exports: solution.exports,
      require: refuseAll,
      module: solution,
      console: logs.console,
    });
  } catch (error) {
    return failed(loadReason("code", error), loadDetail(error), logs.lines);
  }

  const registered: { name: string; fn: () => unknown }[] = [];
  const prefixes: string[] = [];
  const test = (name: unknown, fn: unknown): void => {
    if (typeof fn !== "function") throw new TypeError(`test "${String(name)}" has no function`);
    registered.push({
      name: truncate([...prefixes, String(name)].join(" › "), NAME_CHARS),
      fn: fn as () => unknown,
    });
  };
  const describe = (name: unknown, fn: unknown): void => {
    if (typeof fn !== "function") return;
    prefixes.push(String(name));
    try {
      (fn as () => void)();
    } finally {
      prefixes.pop();
    }
  };

  const testModule = { exports: {} as Record<string, unknown> };
  try {
    evaluate(input.tests, {
      exports: testModule.exports,
      require: (specifier: unknown) => {
        if (typeof specifier === "string" && SOLUTION_SPECIFIERS.has(specifier)) {
          // Read at call time, not captured: code that reassigns
          // `module.exports = …` is exporting the replacement, not the first object.
          return solution.exports;
        }
        throw new ImportRefused(String(specifier));
      },
      module: testModule,
      console: logs.console,
      test,
      it: test,
      describe,
      expect,
    });
  } catch (error) {
    return failed(loadReason("tests", error), loadDetail(error), logs.lines);
  }

  if (registered.length === 0) return failed("nothing-registered", null, logs.lines);
  // Before running any: the app rejects a reply with more results than this, and a
  // rejected reply waits out the clock and reads as "look for a loop that never ends".
  if (registered.length > RESULTS_MAX) {
    return failed("too-many-tests", String(registered.length), logs.lines);
  }

  const results: HarnessResult[] = [];
  // Sequentially, on purpose: exercises test one function, and two tests
  // interleaving over shared state is a failure nobody learning should debug.
  for (const { name, fn } of registered) {
    try {
      await fn();
      results.push({ name, passed: true, message: null });
    } catch (error) {
      results.push({ name, passed: false, message: truncate(describeError(error), MESSAGE_CHARS) });
    }
  }

  return { status: "completed", reason: null, results, message: null, logs: logs.lines };
}

function refuseAll(specifier: unknown): never {
  throw new ImportRefused(String(specifier));
}

/** Which of the load failures this was. A refused import is its own key: it is the lesson's bug. */
function loadReason(who: "code" | "tests", error: unknown): RunReason {
  if (error instanceof ImportRefused) return "import-refused";
  if (error instanceof SyntaxError) return who === "code" ? "code-syntax" : "tests-syntax";
  return who === "code" ? "code-load" : "tests-load";
}

function loadDetail(error: unknown): string {
  return error instanceof ImportRefused ? error.specifier : describeError(error);
}

/**
 * Evaluate a CommonJS module body with exactly these bindings in scope.
 *
 * `console` is passed as a parameter, shadowing the global inside the module,
 * so capture needs no global mutation — the same function runs under `bun test`
 * without swallowing the test runner's own output.
 */
function evaluate(source: string, scope: Record<string, unknown>): void {
  const names = Object.keys(scope);
  // Running code is this file's entire purpose, and it runs inside a worker in the
  // JavaScript runner's sandboxed frame, under `connect-src 'none'` — one of the two
  // runner pages, the only places in Mindforge where `'unsafe-eval'` is allowed
  // (TECH-DESIGN.md §7.5).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const body = new Function(...names, source) as (...args: unknown[]) => unknown;
  body(...names.map((name) => scope[name]));
}

function failed(reason: RunReason, detail: string | null, logs: readonly string[]): HarnessOutput {
  return {
    status: "error",
    reason,
    results: [],
    message: detail === null ? null : truncate(detail, MESSAGE_CHARS),
    logs,
  };
}

function createLogs(): { console: Record<string, (...args: unknown[]) => void>; lines: string[] } {
  const lines: string[] = [];
  const write =
    (level: string) =>
    (...args: unknown[]): void => {
      if (lines.length >= LOG_LINES_MAX) return;
      const text = args.map((arg) => (typeof arg === "string" ? arg : format(arg))).join(" ");
      lines.push(truncate(level === "log" ? text : `[${level}] ${text}`, LOG_LINE_CHARS));
    };

  return {
    console: {
      log: write("log"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      debug: write("debug"),
    },
    lines,
  };
}

// ============================================================================
// expect
// ============================================================================

/** A failed expectation. A class so a thrown `Error` from the learner's code reads differently. */
export class ExpectationError extends Error {
  override readonly name = "ExpectationError";
}

type Matchers = Record<string, (...args: unknown[]) => unknown>;

export function expect(actual: unknown): Matchers & {
  not: Matchers;
  resolves: Matchers & { not: Matchers };
  rejects: Matchers & { not: Matchers };
} {
  const sync = (negated: boolean): Matchers => matchers(() => actual, negated);

  const settled = (mode: "resolves" | "rejects", negated: boolean): Matchers => {
    const wrapped: Matchers = {};
    for (const name of Object.keys(matchers(() => undefined, false))) {
      wrapped[name] = async (...args: unknown[]) => {
        let value: unknown;
        try {
          const resolved: unknown = await actual;
          if (mode === "rejects") {
            throw new ExpectationError(
              `expected a rejection, but it resolved to ${format(resolved)}`,
            );
          }
          value = resolved;
        } catch (error) {
          if (error instanceof ExpectationError) throw error;
          if (mode === "resolves") {
            throw new ExpectationError(
              `expected it to resolve, but it rejected: ${describeError(error)}`,
            );
          }
          value = error;
        }
        // `rejects.toThrow` means "the rejection is this error", so the matcher is
        // handed a thunk that throws it — the same shape `toThrow` takes anyway.
        const subject =
          name === "toThrow"
            ? () => {
                throw value;
              }
            : value;
        return matchers(() => subject, negated)[name]!(...args);
      };
    }
    return wrapped;
  };

  return Object.assign(sync(false), {
    not: sync(true),
    resolves: Object.assign(settled("resolves", false), { not: settled("resolves", true) }),
    rejects: Object.assign(settled("rejects", false), { not: settled("rejects", true) }),
  });
}

function matchers(get: () => unknown, negated: boolean): Matchers {
  /** Assert `pass`, reading the message as "expected <actual> <phrase>". */
  const check = (pass: boolean, phrase: string): void => {
    if (pass === negated) {
      throw new ExpectationError(`expected ${format(get())} ${negated ? "not " : ""}${phrase}`);
    }
  };

  const number = (value: unknown, matcher: string): number => {
    if (typeof value !== "number" && typeof value !== "bigint") {
      throw new ExpectationError(`${matcher} needs a number, but got ${format(value)}`);
    }
    return Number(value);
  };

  return {
    toBe: (expected) => check(Object.is(get(), expected), `to be ${format(expected)}`),
    toEqual: (expected) => check(deepEqual(get(), expected), `to equal ${format(expected)}`),
    toBeTruthy: () => check(Boolean(get()), "to be truthy"),
    toBeFalsy: () => check(!get(), "to be falsy"),
    toBeNull: () => check(get() === null, "to be null"),
    toBeUndefined: () => check(get() === undefined, "to be undefined"),
    toBeDefined: () => check(get() !== undefined, "to be defined"),
    toContain: (item) => {
      const value = get();
      const pass =
        typeof value === "string"
          ? typeof item === "string" && value.includes(item)
          : value instanceof Set || value instanceof Map
            ? value.has(item)
            : Array.isArray(value)
              ? value.some((entry) => Object.is(entry, item) || deepEqual(entry, item))
              : false;
      check(pass, `to contain ${format(item)}`);
    },
    toHaveLength: (length) => {
      const value = get() as { length?: unknown } | null | undefined;
      const actualLength = value === null || value === undefined ? undefined : value.length;
      if (typeof actualLength !== "number") {
        throw new ExpectationError(`expected ${format(get())} to have a length`);
      }
      if ((actualLength === length) === negated) {
        throw new ExpectationError(
          `expected length ${negated ? "not " : ""}to be ${format(length)}, but it was ${actualLength}`,
        );
      }
    },
    toMatch: (pattern) => {
      const value = get();
      if (typeof value !== "string")
        throw new ExpectationError(`toMatch needs a string, but got ${format(value)}`);
      const pass =
        pattern instanceof RegExp
          ? pattern.test(value)
          : value.includes(typeof pattern === "string" ? pattern : format(pattern));
      check(pass, `to match ${format(pattern)}`);
    },
    toBeGreaterThan: (bound) =>
      check(
        number(get(), "toBeGreaterThan") > number(bound, "toBeGreaterThan"),
        `to be greater than ${format(bound)}`,
      ),
    toBeGreaterThanOrEqual: (bound) =>
      check(
        number(get(), "toBeGreaterThanOrEqual") >= number(bound, "toBeGreaterThanOrEqual"),
        `to be at least ${format(bound)}`,
      ),
    toBeLessThan: (bound) =>
      check(
        number(get(), "toBeLessThan") < number(bound, "toBeLessThan"),
        `to be less than ${format(bound)}`,
      ),
    toBeLessThanOrEqual: (bound) =>
      check(
        number(get(), "toBeLessThanOrEqual") <= number(bound, "toBeLessThanOrEqual"),
        `to be at most ${format(bound)}`,
      ),
    toBeCloseTo: (expected, digits = 2) => {
      const precision = typeof digits === "number" ? digits : 2;
      const pass =
        Math.abs(number(get(), "toBeCloseTo") - number(expected, "toBeCloseTo")) <
        10 ** -precision / 2;
      check(pass, `to be close to ${format(expected)}`);
    },
    toThrow: (expected) => {
      const fn = get();
      if (typeof fn !== "function") {
        throw new ExpectationError(`toThrow needs a function to call, but got ${format(fn)}`);
      }
      let thrown: { error: unknown } | null = null;
      try {
        (fn as () => unknown)();
      } catch (error) {
        thrown = { error };
      }

      // A thrown string is its own message; `throw "boom"` should match "boom".
      const message =
        thrown === null
          ? ""
          : thrown.error instanceof Error
            ? thrown.error.message
            : String(thrown.error);
      const matches =
        thrown !== null &&
        (expected === undefined ||
          (expected instanceof RegExp
            ? expected.test(message)
            : message.includes(typeof expected === "string" ? expected : format(expected))));

      if (matches === negated) {
        const wanted = expected === undefined ? "" : ` matching ${format(expected)}`;
        if (negated)
          throw new ExpectationError(`expected it not to throw${wanted}, but it threw: ${message}`);
        throw new ExpectationError(
          thrown === null
            ? `expected it to throw${wanted}, but it didn't throw`
            : `expected it to throw${wanted}, but it threw: ${message}`,
        );
      }
    },
  };
}

// ============================================================================
// Equality and formatting
// ============================================================================

/** Structural equality: arrays, plain objects, Map, Set, Date, RegExp, and NaN equal to itself. */
export function deepEqual(a: unknown, b: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  // A cycle already being compared is assumed equal on the second visit.
  if (seen.get(a) === b) return true;
  seen.set(a, b);

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && String(a) === String(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key) || !deepEqual(value, b.get(key), seen)) return false;
    }
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    outer: for (const value of a) {
      if (b.has(value)) continue;
      for (const candidate of b) if (deepEqual(value, candidate, seen)) continue outer;
      return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  return keysA.every(
    (key) => Object.hasOwn(recordB, key) && deepEqual(recordA[key], recordB[key], seen),
  );
}

/** A value as a learner would write it, short enough for one line of a result. */
export function format(value: unknown): string {
  return truncate(render(value, 0, new WeakSet()), VALUE_CHARS);
}

function render(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return value.name ? `[Function ${value.name}]` : "[Function]";
  if (typeof value === "symbol") return value.toString();
  if (typeof value !== "object" || value === null)
    return Object.is(value, -0) ? "-0" : String(value);

  if (seen.has(value)) return "[Circular]";
  if (depth > 3) return Array.isArray(value) ? "[…]" : "{…}";
  seen.add(value);

  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (Array.isArray(value)) return `[${value.map((v) => render(v, depth + 1, seen)).join(", ")}]`;
  if (value instanceof Map) {
    const entries = [...value].map(
      ([k, v]) => `${render(k, depth + 1, seen)} => ${render(v, depth + 1, seen)}`,
    );
    return `Map {${entries.join(", ")}}`;
  }
  if (value instanceof Set)
    return `Set {${[...value].map((v) => render(v, depth + 1, seen)).join(", ")}}`;

  const entries = Object.entries(value).map(([k, v]) => `${k}: ${render(v, depth + 1, seen)}`);
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
}

function describeError(error: unknown): string {
  if (error instanceof ExpectationError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `threw ${format(error)}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
