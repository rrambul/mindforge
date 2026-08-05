import { describe, expect, it } from "vitest";
import type { MessageVars, ServerMessageKey } from "../i18n/server-messages.js";
import {
  DomainError,
  isDomainError,
  type DomainErrorKind,
  type FieldViolation,
} from "./domain-error.js";

class WipLimitReached extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "wip-limit-reached";
  readonly detailKey: ServerMessageKey = "error.mission.wip_limit";
  override readonly detailVars: MessageVars;

  constructor(limit: number) {
    super(`WIP limit of ${limit} active missions reached`);
    this.detailVars = { limit };
  }
}

class Malformed extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "validation-failed";
  readonly detailKey: ServerMessageKey = "error.validation_failed";
  override readonly violations: readonly FieldViolation[];

  constructor(violations: readonly FieldViolation[]) {
    super("validation failed");
    this.violations = violations;
  }
}

describe("DomainError", () => {
  it("is a real Error, so it survives every catch and logger in the stack", () => {
    const error = new WipLimitReached(3);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("WIP limit of 3 active missions reached");
    expect(error.stack).toBeTruthy();
  });

  it("names itself after the subclass rather than 'Error'", () => {
    // So a log line identifies the rule that was broken without the stack.
    expect(new WipLimitReached(3).name).toBe("WipLimitReached");
  });

  it("carries the machine key, the message key, and its ICU arguments", () => {
    const error = new WipLimitReached(3);
    expect(error.kind).toBe("conflict");
    expect(error.slug).toBe("wip-limit-reached");
    expect(error.detailKey).toBe("error.mission.wip_limit");
    expect(error.detailVars).toEqual({ limit: 3 });
  });

  it("defaults to no vars and no violations", () => {
    // §6.1: everything that isn't a validation failure carries `errors: []`.
    class Bare extends DomainError {
      readonly kind: DomainErrorKind = "not_found";
      readonly slug = "mission-not-found";
      readonly detailKey: ServerMessageKey = "error.mission.not_found";
      constructor() {
        super("gone");
      }
    }
    const error = new Bare();
    expect(error.detailVars).toEqual({});
    expect(error.violations).toEqual([]);
  });

  it("carries field violations when the request itself was malformed", () => {
    const violations = [{ field: "topic", code: "too_small", message: "String too short" }];
    expect(new Malformed(violations).violations).toEqual(violations);
  });
});

describe("isDomainError", () => {
  it("recognises a domain error", () => {
    expect(isDomainError(new WipLimitReached(3))).toBe(true);
  });

  it("rejects everything else, including plain Errors", () => {
    // The exception filter branches on this to decide between a mapped problem
    // and a 500. A false positive here would leak internal messages to users.
    expect(isDomainError(new Error("infrastructure exploded"))).toBe(false);
    expect(isDomainError("wip-limit-reached")).toBe(false);
    expect(isDomainError(null)).toBe(false);
    expect(isDomainError(undefined)).toBe(false);
  });
});
