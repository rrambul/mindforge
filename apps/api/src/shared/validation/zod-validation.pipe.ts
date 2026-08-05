import type { FieldViolation } from "@mindforge/core";
import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import { ValidationFailedError } from "../errors/common-errors.js";

/**
 * Validates a request payload against a Zod schema from `packages/core`.
 *
 * One definition, three consumers — API validation, SPA forms, and LLM
 * structured outputs all read the same schema, so a field cannot drift between
 * what the server accepts and what the form collects (TECH-DESIGN.md §2.2 rule 3).
 *
 * Used per-parameter rather than globally, because a global pipe would need to
 * discover the schema from a DTO class and that is precisely the layer of
 * decorator metadata this codebase does not have. `@Body(zodPipe(Schema))` says
 * out loud what shape the handler takes.
 */
export class ZodValidationPipe<TOut> implements PipeTransform<unknown, TOut> {
  constructor(private readonly schema: ZodType<TOut>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new ValidationFailedError(result.error.issues.map(toViolation));
  }
}

/** Reads better at the call site than `new ZodValidationPipe(Schema)`. */
export function zodPipe<TOut>(schema: ZodType<TOut>): ZodValidationPipe<TOut> {
  return new ZodValidationPipe(schema);
}

interface ZodIssueLike {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly message: string;
}

function toViolation(issue: ZodIssueLike): FieldViolation {
  return {
    // Dotted, with array indices in place: `targets.0.kind`. The SPA hands this
    // straight to react-hook-form's setError, which uses the same notation.
    field: issue.path.map(String).join(".") || "(root)",
    // Zod's code — `too_small`, `invalid_type`. This is the stable machine key
    // the SPA maps to its own translated field-level copy.
    code: issue.code,
    // English, developer-facing, and never rendered to a user. See FieldViolation.
    message: issue.message,
  };
}
