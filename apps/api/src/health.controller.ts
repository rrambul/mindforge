import { Controller, Get } from "@nestjs/common";

/**
 * "Which code and which schema is actually running" is the first question when
 * something is wrong in production. It should take one request to answer.
 * See TECH-DESIGN.md §14.1.
 */
@Controller({ path: "health", version: "1" })
export class HealthController {
  @Get()
  get(): Record<string, string> {
    return {
      status: "ok",
      service: "api",
      version: process.env["APP_VERSION"] ?? "0.0.0",
      commit: process.env["GIT_SHA"] ?? "dev",
      migration: process.env["MIGRATION_NAME"] ?? "none",
    };
  }
}
