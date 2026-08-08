#!/usr/bin/env node
/**
 * Proves the architectural boundary rules actually fire.
 *
 * This exists because they once did not. `eslint-plugin-boundaries` was configured
 * with v5 syntax against a v7 plugin, and — the part that really did the damage —
 * module resolution was left at the default node resolver, which cannot follow
 * TypeScript's ESM convention of writing `./foo.js` for a file that is `./foo.ts`.
 * Every internal import therefore resolved to nothing, every dependency was
 * classified as unknown, and the rule reported no violations. Lint was green, CI was
 * green, and TECH-DESIGN.md §2.1's "enforced, not conventional. A violation is a
 * build failure" was false for the entire life of the project.
 *
 * A rule that silently enforces nothing cannot be caught by the absence of errors,
 * so it needs a test that expects errors. Fixtures are written into the real source
 * tree, linted with the real config, and deleted — no permanent files to keep out of
 * tsconfig, no eslint-ignore juggling, and no way for the fixtures to drift from the
 * configuration they are checking.
 */

import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;

/**
 * Each fixture is a file plus what the rule must say about it. The legal ones matter
 * as much as the illegal ones: a rule that flags everything is just as broken as one
 * that flags nothing, and it would be "fixed" by turning it off.
 */
const FIXTURES = [
  {
    path: "apps/api/src/modules/missions/domain/__boundary-illegal.ts",
    code: `import { PrismaMissionRepository } from "../infrastructure/prisma-mission.repository.js";\nexport const bad = PrismaMissionRepository;\n`,
    violation: "api-domain must not depend on api-infrastructure",
  },
  {
    path: "apps/api/src/modules/missions/domain/__boundary-legal.ts",
    code: `import { MISSION_WIP_LIMIT } from "@mindforge/core";\nexport const ok = MISSION_WIP_LIMIT;\n`,
    violation: null,
  },
  {
    // The composition-root exemption is scoped to *.module.ts, so a controller must
    // still be refused. This is the assertion that keeps that exemption honest.
    path: "apps/api/src/modules/missions/presentation/__boundary-illegal.ts",
    code: `import { PrismaMissionRepository } from "../infrastructure/prisma-mission.repository.js";\nexport const bad = PrismaMissionRepository;\n`,
    violation: "api-presentation must not depend on api-infrastructure",
  },
  {
    path: "apps/api/src/modules/missions/presentation/__boundary-module.module.ts",
    code: `import { PrismaMissionRepository } from "../infrastructure/prisma-mission.repository.js";\nexport const wiring = PrismaMissionRepository;\n`,
    violation: null,
  },
  {
    path: "apps/web/src/features/__alpha/api/thing.ts",
    code: `export const alphaThing = 1;\n`,
    violation: null,
  },
  {
    path: "apps/web/src/features/__alpha/api/__boundary-legal.ts",
    code: `import { alphaThing } from "./thing.js";\nexport const ok = alphaThing;\n`,
    violation: null,
  },
  {
    path: "apps/web/src/features/__beta/api/__boundary-illegal.ts",
    code: `import { alphaThing } from "../../__alpha/api/thing.js";\nexport const bad = alphaThing;\n`,
    violation: "web-feature must not depend on web-feature",
  },
  {
    path: "apps/web/src/shared/lib/__boundary-illegal.ts",
    code: `import { alphaThing } from "../../features/__alpha/api/thing.js";\nexport const bad = alphaThing;\n`,
    violation: "web-shared must not depend on web-feature",
  },
  {
    // `packages/workspace` is guarded by `no-restricted-imports` rather than by the
    // boundaries plugin, which is scoped to apps/*. Different mechanism, same need
    // for proof: a `paths`/`patterns` typo is silent in exactly the same way.
    //
    // The constraint is the package's whole justification for existing outside
    // apps/worker — it is importable by both the worker and the API only while it
    // stays a pure function of bytes.
    path: "packages/workspace/src/__boundary-illegal.ts",
    code: `import { readFile } from "node:fs/promises";\nexport const bad = readFile;\n`,
    rule: "no-restricted-imports",
    violation: "the filesystem lives in apps/worker",
  },
  {
    path: "packages/workspace/src/__boundary-illegal-vendor.ts",
    code: `import { createClient } from "@supabase/supabase-js";\nexport const bad = createClient;\n`,
    rule: "no-restricted-imports",
    violation: "framework- and vendor-free",
  },
  {
    path: "packages/workspace/src/__boundary-legal.ts",
    code: `import { createHash } from "node:crypto";\nexport const ok = createHash;\n`,
    rule: "no-restricted-imports",
    violation: null,
  },
];

async function lint(paths) {
  try {
    const { stdout } = await run("pnpm", ["exec", "eslint", "--format", "json", ...paths], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    // eslint exits non-zero when it reports errors, which is the expected case here.
    if (typeof error.stdout === "string" && error.stdout.trim().startsWith("[")) {
      return JSON.parse(error.stdout);
    }
    throw error;
  }
}

async function main() {
  const created = [];
  try {
    for (const fixture of FIXTURES) {
      const absolute = join(root, fixture.path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, fixture.code);
      created.push(absolute);
    }

    const results = await lint(FIXTURES.map((f) => join(root, f.path)));
    const byPath = new Map(results.map((r) => [r.filePath, r]));
    const failures = [];

    for (const fixture of FIXTURES) {
      const absolute = join(root, fixture.path);
      // Which rule is expected to speak, since not every boundary in this repo is
      // enforced by the same one: `boundaries` is scoped to apps/*, and a package's
      // constraints are `no-restricted-imports`. Filtering to one rule id would let
      // the other kind pass while enforcing nothing, which is the exact failure this
      // script exists to catch.
      const rule = fixture.rule ?? "boundaries/dependencies";
      const messages = (byPath.get(absolute)?.messages ?? []).filter((m) => m.ruleId === rule);

      if (fixture.violation === null) {
        if (messages.length > 0) {
          failures.push(
            `${fixture.path}\n    expected no boundary error, got: ${messages.map((m) => m.message).join("; ")}`,
          );
        }
        continue;
      }

      if (messages.length === 0) {
        failures.push(
          `${fixture.path}\n    expected "${fixture.violation}" but the rule reported nothing.\n` +
            `    This is the original bug: the rule loads, lint passes, and no boundary is enforced.`,
        );
      } else if (!messages.some((m) => m.message.includes(fixture.violation))) {
        failures.push(
          `${fixture.path}\n    expected "${fixture.violation}", got: ${messages.map((m) => m.message).join("; ")}`,
        );
      }
    }

    if (failures.length > 0) {
      console.error(`\nBoundary enforcement is broken (${failures.length}):\n`);
      for (const failure of failures) console.error(`  ✖ ${failure}\n`);
      process.exitCode = 1;
      return;
    }

    console.log(`Boundary enforcement verified across ${FIXTURES.length} fixtures.`);
  } finally {
    // Always, including on a thrown error: a leftover fixture makes the next real
    // lint fail for a reason that has nothing to do with the code being linted.
    await Promise.all(created.map((path) => rm(path, { force: true })));
    await rm(join(root, "apps/web/src/features/__alpha"), { recursive: true, force: true });
    await rm(join(root, "apps/web/src/features/__beta"), { recursive: true, force: true });
  }
}

await main();
