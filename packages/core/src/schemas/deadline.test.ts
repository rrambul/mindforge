import { describe, expect, it } from "vitest";

import { SetDeadlineSchema } from "./deadline.js";

describe("SetDeadlineSchema", () => {
  it("takes a real calendar day and nothing else", () => {
    expect(SetDeadlineSchema.parse({ dueOn: "2026-10-14" })).toEqual({ dueOn: "2026-10-14" });
    expect(SetDeadlineSchema.safeParse({ dueOn: "2026-02-30" }).success).toBe(false);
    expect(SetDeadlineSchema.safeParse({ dueOn: "2026-10-14T00:00:00Z" }).success).toBe(false);
  });

  it("refuses a day outside the range the table accepts, so it is a 422 and not a 500", () => {
    // `module_deadlines_due_on_plausible` is 2020-01-01..2100-12-31. A year typed
    // as 2206 would otherwise pass here and fail in Postgres.
    expect(SetDeadlineSchema.safeParse({ dueOn: "2101-01-01" }).success).toBe(false);
    expect(SetDeadlineSchema.safeParse({ dueOn: "2019-12-31" }).success).toBe(false);
    expect(SetDeadlineSchema.safeParse({ dueOn: "2100-12-31" }).success).toBe(true);
  });
});
