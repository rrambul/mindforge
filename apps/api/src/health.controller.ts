import { Controller, Get } from "@nestjs/common";
import { readdirSync, readFileSync } from "node:fs";
import { Public } from "./shared/auth/public.decorator.js";

/**
 * "Which code and which schema is actually running" is the first question when something is wrong in
 * production. It should take one request to answer. See TECH-DESIGN.md §14.1.
 *
 * The path is `health` rather than `v1/health`: `setGlobalPrefix("v1")` supplies the base path
 * (§6.1), and having the controller restate it produced `/v1/health` by coincidence rather than by
 * design.
 *
 * **Until M2 all three fields were env vars nothing set**, so every deploy would have reported
 * `0.0.0 / dev / none` — an endpoint whose whole purpose is answering that question, answering it
 * with a placeholder. `APP_VERSION` and `GIT_SHA` are now injected at build time; the migration name
 * is read from disk, because the alternative was a fourth thing to remember to set.
 */
@Controller("health")
export class HealthController {
  /**
   * Resolved once at construction. It reads the filesystem, and a liveness probe is the last thing
   * that should do that on every request — a slow disk would turn "is it up?" into a timeout.
   */
  private readonly migration = latestMigration();

  /** A liveness probe that needs a token cannot report that auth is broken. */
  @Public()
  @Get()
  get(): Record<string, string> {
    return {
      status: "ok",
      service: "api",
      version: this.version,
      // The one field still waiting on a deploy pipeline. There is no build step in CI and Railway
      // is unprovisioned (CLAUDE.md), so nothing sets this yet — `dev` is the honest answer rather
      // than a made-up hash, and it becomes real the day something builds a container.
      commit: process.env["GIT_SHA"] ?? "dev",
      migration: this.migration,
    };
  }

  private readonly version = process.env["APP_VERSION"] ?? readRootVersion();
}

/**
 * The product version, from the root `package.json`.
 *
 * §14.1 makes that file the single source of truth and release-please the only thing that writes it,
 * so reading it is strictly better than an env var a deploy might forget: it is right in dev, right
 * in CI, and right in a container, with nothing to configure. `APP_VERSION` still wins if it is set,
 * for a build that stamps it in and ships no manifest.
 */
function readRootVersion(): string {
  try {
    const manifest = new URL("../../../package.json", import.meta.url);
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    const version =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { version?: unknown }).version
        : undefined;
    return typeof version === "string" ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * The newest migration directory on disk.
 *
 * Prisma names them `<timestamp>_<name>` and applies them in lexical order, so the last one sorted is
 * the schema this build carries. Deliberately **not** a query against `_prisma_migrations`: that
 * would report what the database has, and the question this endpoint exists to answer is what *this
 * process* was built with. When those two disagree — a deploy that shipped before its migration ran —
 * the disagreement is the answer, and reading the database would hide it.
 */
function latestMigration(): string {
  // Relative to this file, which is at apps/api/src/ in dev and apps/api/dist/ once built. Both are
  // two levels below apps/api, so the path holds either way.
  const dir = new URL("../../../packages/db/prisma/migrations/", import.meta.url);

  try {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return names.at(-1) ?? "none";
  } catch {
    // A container that ships only `dist/` has no migrations directory, and a health endpoint that
    // threw because it could not find one would report the service as down over a missing label.
    return "unknown";
  }
}
