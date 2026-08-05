import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationFailedError } from "../errors/common-errors.js";
import { zodPipe } from "./zod-validation.pipe.js";

const Schema = z.object({
  topic: z.string().min(3),
  why: z.string().optional(),
  targets: z.array(z.object({ kind: z.enum(["skill_band", "artifact"]) })).default([]),
});

describe("ZodValidationPipe", () => {
  it("returns the parsed value, not the raw one", () => {
    // Defaults and coercions must reach the handler. A pipe that validates and
    // then passes the original object through is worse than no pipe: the types
    // say one thing and the runtime holds another.
    expect(zodPipe(Schema).transform({ topic: "Rust ownership" })).toEqual({
      topic: "Rust ownership",
      targets: [],
    });
  });

  it("strips unknown keys rather than passing them to the repository", () => {
    const parsed = zodPipe(Schema).transform({
      topic: "Rust",
      status: "active",
      userId: "someone",
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("userId");
  });

  it("raises a validation failure the exception filter already knows how to render", () => {
    expect(() => zodPipe(Schema).transform({ topic: "no" })).toThrow(ValidationFailedError);
  });

  it("reports the field, a stable code, and developer detail", () => {
    let violations: readonly { field: string; code: string; message: string }[] = [];
    try {
      zodPipe(Schema).transform({ topic: "no" });
    } catch (error) {
      violations = (error as ValidationFailedError).violations;
    }

    expect(violations).toHaveLength(1);
    expect(violations[0]?.field).toBe("topic");
    // The SPA maps `code` to its own translated field-level copy; `message` is
    // English developer detail and is never rendered.
    expect(violations[0]?.code).toBe("too_small");
    expect(violations[0]?.message).toBeTruthy();
  });

  it("writes nested paths in the notation react-hook-form expects", () => {
    // `targets.0.kind`, so the SPA can hand it straight to setError. Bracket
    // notation or a raw array would need translating on the client.
    let violations: readonly { field: string }[] = [];
    try {
      zodPipe(Schema).transform({ topic: "Rust", targets: [{ kind: "nonsense" }] });
    } catch (error) {
      violations = (error as ValidationFailedError).violations;
    }
    expect(violations[0]?.field).toBe("targets.0.kind");
  });

  it("reports every failure at once, not just the first", () => {
    // A form that surfaces one error per submit takes four round trips to fill in.
    let violations: readonly { field: string }[] = [];
    try {
      zodPipe(Schema).transform({ topic: "no", targets: [{ kind: "nope" }] });
    } catch (error) {
      violations = (error as ValidationFailedError).violations;
    }
    expect(violations.map((v) => v.field).sort()).toEqual(["targets.0.kind", "topic"]);
  });

  it("labels a whole-body failure rather than emitting an empty field name", () => {
    // `undefined` and `"a string"` fail at the root, where Zod's path is empty.
    // An empty `field` would render as a form error attached to nothing.
    let violations: readonly { field: string }[] = [];
    try {
      zodPipe(Schema).transform("not an object");
    } catch (error) {
      violations = (error as ValidationFailedError).violations;
    }
    expect(violations[0]?.field).toBe("(root)");
  });
});
