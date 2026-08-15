import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "./cursor.js";

const KEYSET = {
  startedAt: new Date("2026-08-08T12:34:56.789Z"),
  id: "3f1a2b4c-1111-4111-8111-222233334444",
};

describe("round trip", () => {
  it("survives encode and decode unchanged", () => {
    const decoded = decodeCursor(encodeCursor(KEYSET));

    expect(decoded?.id).toBe(KEYSET.id);
    // To the millisecond: two sessions a second apart must not collapse onto one
    // page boundary.
    expect(decoded?.startedAt.toISOString()).toBe("2026-08-08T12:34:56.789Z");
  });

  it("is url-safe, because it travels in a query string", () => {
    // Plain base64's `+` and `/` would be re-encoded by one client and not
    // another, and a cursor that changes in transit is a page that silently
    // restarts.
    expect(encodeCursor(KEYSET)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is opaque, so the shape can change without breaking a client", () => {
    expect(encodeCursor(KEYSET)).not.toContain(KEYSET.id);
  });
});

describe("rejecting a cursor that is not one of ours", () => {
  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["not base64", "!!!!"],
    ["base64 of nonsense", btoa("hello")],
    ["a timestamp with no id", btoa("2026-08-08T12:00:00.000Z|").replace(/=+$/, "")],
    ["an id with no timestamp", btoa("|abc").replace(/=+$/, "")],
    ["an unparseable date", btoa("not-a-date|abc").replace(/=+$/, "")],
  ])("returns null for %s", (_label, value) => {
    // Null rather than a throw: a stale cursor from a bookmark or a previous
    // release should serve the first page, not a 500.
    expect(decodeCursor(value)).toBeNull();
  });
});

describe("the separator", () => {
  it("refuses a cursor whose id contained one, rather than splitting it somewhere plausible", () => {
    // Ids are uuids and cannot contain `|`, so this is unreachable in the product
    // — but the failure mode if it were reachable is the one that matters:
    // `lastIndexOf` would leave `…789Z|a` as the timestamp, which is not a date,
    // and the cursor is rejected. Rejecting serves the first page; splitting on
    // the *first* pipe would have produced a valid-looking cursor pointing at the
    // wrong row.
    expect(decodeCursor(encodeCursor({ startedAt: KEYSET.startedAt, id: "a|b" }))).toBeNull();
  });
});
