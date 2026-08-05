import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

/**
 * Identity as a dependency, for the same reason as `Clock`.
 *
 * A use case that reaches for `randomUUID()` directly cannot be asserted against
 * — the test has to read the id back out of the thing it just created, which
 * proves the id exists rather than that the right one was used. It also matters
 * for the offline queue (§6.1): capture endpoints accept a client-generated id
 * and upsert, so "who minted this id" is a real question with two answers.
 */
export interface IdGenerator {
  next(): string;
}

export const ID_GENERATOR = Symbol("IdGenerator");

@Injectable()
export class UuidGenerator implements IdGenerator {
  next(): string {
    // v4, from the platform CSPRNG. Ids reach URLs, so they must not be guessable
    // even though RLS is what actually stops a cross-user read.
    return randomUUID();
  }
}

/** For tests: predictable, ordered, and still uuid-shaped so it survives a uuid column. */
export class SequentialIdGenerator implements IdGenerator {
  private issued = 0;

  next(): string {
    this.issued += 1;
    const suffix = this.issued.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${suffix}`;
  }
}
