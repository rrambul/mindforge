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
});
