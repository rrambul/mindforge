import { Controller, Get } from "@nestjs/common";
import { Public } from "./shared/auth/public.decorator.js";

/**
 * "Which code and which schema is actually running" is the first question when
 * something is wrong in production. It should take one request to answer.
 * See TECH-DESIGN.md §14.1.
 *
 * The path is `health` rather than `v1/health`: `setGlobalPrefix("v1")` supplies
 * the base path (§6.1), and having the controller restate it produced
 * `/v1/health` by coincidence rather than by design.
 */
@Controller("health")
export class HealthController {
  /** A liveness probe that needs a token cannot report that auth is broken. */
  @Public()
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
