"""The Python exercise harness (FR-X3, PLAN-HANDS-ON.md Phase 5).

Runs inside Pyodide in the runner's worker, and under the system `python3` in
`python-harness.test.ts` — so it uses the standard library only and nothing
Pyodide-specific. It is the Python half of `harness.ts`, and it answers in the
same shape: a JSON object the client relays as a `RunnerResponse` — a `reason`
key the app translates, and `message` as raw detail only, never a sentence of ours.

The contract an exercise's tests are written against:

- The learner's code is the module `solution`: `from solution import committed_index`.
- A test is a top-level function whose name starts with `test`, run in the order
  it was defined. It passes if it returns, and fails on any exception.
- Failures are plain `assert`. An `assert x == y, "message"` fails with its
  message; a bare `assert` fails with the line that failed, because "assertion
  failed" with no line is a learner told they are wrong and not where.
- `print` is captured, capped, and shown with the run.
"""

import io
import json
import linecache
import sys
import traceback
import types

LOG_LINES_MAX = 100
LOG_LINE_CHARS = 1_000
MESSAGE_CHARS = 4_000
NAME_CHARS = 500

# `RESULTS_MAX` in packages/core. A copy, because this file runs where core cannot
# be imported; `harness.test.ts` reads core's value, so the two cannot drift apart.
RESULTS_MAX = 200

TESTS_FILE = "tests.py"
SOLUTION_FILE = "solution.py"


class _Capture(io.TextIOBase):
    """`print` output, as lines, capped the way the JavaScript harness caps `console.log`."""

    def __init__(self):
        self.lines = []
        self._partial = ""

    def write(self, text):
        self._partial += text
        *done, self._partial = self._partial.split("\n")
        for line in done:
            self._add(line)
        return len(text)

    def flush_partial(self):
        if self._partial:
            self._add(self._partial)
            self._partial = ""

    def _add(self, line):
        if len(self.lines) < LOG_LINES_MAX:
            self.lines.append(line[:LOG_LINE_CHARS])


def _cap(text, limit):
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _humanise(name):
    """`test_three_nodes_need_two_copies` → `three nodes need two copies`."""
    words = name[5:] if name.startswith("test_") else name[4:]
    return (words.replace("_", " ").strip() or name)[:NAME_CHARS]


def _register(filename, source):
    # So a traceback can quote the failing line of code that was never a file.
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)


def _failure(error):
    if isinstance(error, AssertionError):
        if str(error):
            return str(error)
        frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename == TESTS_FILE]
        if frames and frames[-1].line:
            return f"assertion failed: {frames[-1].line.strip()}"
        return "assertion failed"
    return f"{type(error).__name__}: {error}"


def _load_failure(who, error):
    """A load failure as (reason key, raw detail). The app words the key (§5.2)."""
    if isinstance(error, SyntaxError):
        return f"{who}-syntax", f"line {error.lineno}: {error.msg}"
    return f"{who}-load", f"{type(error).__name__}: {error}"


def run(code, tests):
    capture = _Capture()
    saved = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = capture

    def answer(status, results=(), reason=None, message=None):
        capture.flush_partial()
        return json.dumps(
            {
                "status": status,
                "reason": reason,
                "results": list(results),
                "message": None if message is None else _cap(message, MESSAGE_CHARS),
                "logs": capture.lines,
            }
        )

    try:
        # A fresh module every run: the worker is kept warm between runs, and a
        # `solution` left over from the last one would pass tests it should fail.
        solution = types.ModuleType("solution")
        solution.__file__ = SOLUTION_FILE
        sys.modules["solution"] = solution
        _register(SOLUTION_FILE, code)
        try:
            exec(compile(code, SOLUTION_FILE, "exec"), solution.__dict__)
        except BaseException as error:  # noqa: BLE001 — a learner's SystemExit is still a load error
            reason, detail = _load_failure("code", error)
            return answer("error", reason=reason, message=detail)

        namespace = {"__name__": "tests"}
        _register(TESTS_FILE, tests)
        try:
            exec(compile(tests, TESTS_FILE, "exec"), namespace)
        except BaseException as error:  # noqa: BLE001
            reason, detail = _load_failure("tests", error)
            return answer("error", reason=reason, message=detail)

        cases = [
            (name, value)
            for name, value in namespace.items()
            if name.startswith("test") and callable(value) and getattr(value, "__module__", None) == "tests"
        ]
        if not cases:
            return answer("error", reason="nothing-registered")
        # Before running any: the app rejects a reply with more results than this,
        # and a rejected reply reads as a timeout — correct code told it loops forever.
        if len(cases) > RESULTS_MAX:
            return answer("error", reason="too-many-tests", message=str(len(cases)))

        results = []
        for name, case in cases:
            try:
                case()
                results.append({"name": _humanise(name), "passed": True, "message": None})
            except BaseException as error:  # noqa: BLE001
                results.append(
                    {"name": _humanise(name), "passed": False, "message": _cap(_failure(error), MESSAGE_CHARS)}
                )
        return answer("completed", results)
    finally:
        sys.stdout, sys.stderr = saved
        sys.modules.pop("solution", None)
