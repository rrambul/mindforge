import { describe, expect, it } from "vitest";
import { PaginationSchema, UuidSchema } from "./common.js";

describe("UuidSchema", () => {
  it("accepts a uuid", () => {
    expect(UuidSchema.parse("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it.each([
    ["a plain word", "not-a-uuid"],
    ["a number", "42"],
    ["empty", ""],
    ["a uuid with a stray character", "11111111-1111-4111-8111-1111111111111"],
  ])("rejects %s", (_label, value) => {
    // Every id here reaches a Postgres uuid column. Unvalidated, it arrives as a
    // failed cast and surfaces as a driver-level 500 rather than the 422 it is.
    expect(UuidSchema.safeParse(value).success).toBe(false);
  });
});

describe("PaginationSchema", () => {
  it("defaults the limit and leaves the cursor absent", () => {
    expect(PaginationSchema.parse({})).toEqual({ limit: 50 });
  });

  it("coerces a limit arriving as a query string", () => {
    // Which is how it always arrives.
    expect(PaginationSchema.parse({ limit: "25" }).limit).toBe(25);
  });

  it("caps the limit so one request cannot ask for everything", () => {
    expect(PaginationSchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(PaginationSchema.parse({ limit: "100" }).limit).toBe(100);
  });

  it("rejects a limit that cannot be one", () => {
    expect(PaginationSchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(PaginationSchema.safeParse({ limit: "-1" }).success).toBe(false);
    expect(PaginationSchema.safeParse({ limit: "1.5" }).success).toBe(false);
    expect(PaginationSchema.safeParse({ limit: "abc" }).success).toBe(false);
  });

  it("rejects an empty cursor rather than treating it as absent", () => {
    expect(PaginationSchema.safeParse({ cursor: "" }).success).toBe(false);
  });

  it("keeps a cursor it was given", () => {
    expect(PaginationSchema.parse({ cursor: "abc123" }).cursor).toBe("abc123");
  });
});
