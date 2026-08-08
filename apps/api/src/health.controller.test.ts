import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports which code and schema are running", () => {
    // "Which build is live" is the first question in an incident; it should
    // take one request. See TECH-DESIGN.md §14.1.
    const body = new HealthController().get();
    expect(body["status"]).toBe("ok");
    expect(body["service"]).toBe("api");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("commit");
    expect(body).toHaveProperty("migration");
  });

  it("names the newest migration this build carries, not a placeholder", () => {
    // All three fields were env vars nothing set, so the endpoint whose whole job is answering
    // "which schema is running" answered `none`. The migration is read from disk instead — and
    // deliberately from disk rather than from `_prisma_migrations`, because when a deploy ships
    // ahead of its migration the disagreement between the two IS the answer.
    expect(new HealthController().get()["migration"]).toMatch(/^\d{14}_\w+$/u);
  });

  it("reports the product version rather than a placeholder", () => {
    // Read from the root package.json, which §14.1 makes the single source of truth and
    // release-please the only writer. An env var a deploy forgets to set reports 0.0.0 forever.
    expect(new HealthController().get()["version"]).not.toBe("0.0.0");
  });
});
