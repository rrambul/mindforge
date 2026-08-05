import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import ts from "typescript-eslint";

/**
 * `pnpm lint` runs per package through turbo, so eslint's cwd is the package
 * directory. eslint-plugin-boundaries matches element patterns against paths
 * relative to `boundaries/root-path`, which defaults to cwd — so the patterns below
 * are anchored to this file's directory instead. Without it they match nothing, the
 * rule reports no violations, and the architecture appears to be enforced.
 *
 * Set BOUNDARIES_DEBUG=1 to have the plugin print how it classified each file.
 */
const DEBUG_BOUNDARIES = process.env["BOUNDARIES_DEBUG"] === "1";

export default ts.config([
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "Use the injected Clock port. A bare new Date() makes time untestable and breaks timezone-derived rollups.",
        },
      ],
    },
  },

  // --- Architectural boundaries (TECH-DESIGN.md §2.1, §2.2) -----------------
  //
  // These are enforced, not conventional. A violation is a build failure.
  //
  // Two things about the shape below are deliberate and were arrived at by testing
  // rather than by reading:
  //
  // 1. **Patterns are app-relative, and each app gets its own config block.**
  //    `pnpm lint` runs per package through turbo, so eslint's cwd is `apps/api`,
  //    not the repo root — a pattern written as `apps/api/src/...` matches nothing.
  //    Scoping each block with `files` lets the patterns drop the app prefix, which
  //    also means `**/src/shared/**` unambiguously refers to that app's shared.
  //
  // 2. **`@mindforge/core` is not modelled as an element.** It resolves as a package
  //    rather than a path, and it is legal from every layer including domain, so
  //    there is nothing to protect. Unmatched dependencies are not checked, which is
  //    what makes framework imports (@nestjs/*, react) legal without enumeration.
  //
  // The four probe files under `apps/*/src/**-BAD.ts` in the commit that introduced
  // this are how it was verified; re-create them if you change any of it, because the
  // previous version of this config looked correct and enforced nothing at all.
  {
    files: ["apps/api/**", "apps/worker/**"],
    plugins: { boundaries },
    settings: {
      "boundaries/debug": { enabled: DEBUG_BOUNDARIES },
      "boundaries/root-path": import.meta.dirname,
      /**
       * TypeScript's ESM convention writes `./foo.js` for a file that is `./foo.ts`.
       * The plugin's default (node) resolver cannot follow that, so every internal
       * import resolved to nothing, every dependency was classified `isUnknown`, and
       * the rule had nothing to check — which is precisely how the previous config
       * passed while enforcing nothing.
       */
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: ["apps/*/tsconfig.json", "packages/*/tsconfig.json"],
        },
      },
      "boundaries/elements": [
        { type: "api-domain", pattern: "apps/*/src/modules/*/domain/**" },
        { type: "api-application", pattern: "apps/*/src/modules/*/application/**" },
        { type: "api-infrastructure", pattern: "apps/*/src/modules/*/infrastructure/**" },
        { type: "api-presentation", pattern: "apps/*/src/modules/*/presentation/**" },
        { type: "api-shared", pattern: "apps/*/src/shared/**" },
      ],
    },
    rules: {
      // domain <- application <- {infrastructure, presentation}
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message:
            "{{from.element.type}} must not depend on {{to.element.type}} — see TECH-DESIGN.md §2.1.",
          policies: [
            {
              // The strictest layer: domain knows itself and packages/core, nothing
              // else. Not even shared — a Clock or an id generator is a port the
              // application injects, and an entity that imported one would be
              // reaching for the framework.
              from: { element: { type: "api-domain" } },
              allow: { to: { element: { type: "api-domain" } } },
            },
            {
              from: { element: { type: "api-application" } },
              allow: {
                to: { element: { type: ["api-domain", "api-application", "api-shared"] } },
              },
            },
            {
              from: { element: { type: "api-infrastructure" } },
              allow: {
                to: {
                  element: {
                    type: ["api-domain", "api-application", "api-infrastructure", "api-shared"],
                  },
                },
              },
            },
            {
              from: { element: { type: "api-presentation" } },
              allow: {
                to: {
                  element: {
                    type: ["api-domain", "api-application", "api-presentation", "api-shared"],
                  },
                },
              },
            },
            {
              // Cross-cutting wiring stays cross-cutting. If shared ever needed a
              // module, that module's concern was not cross-cutting after all.
              from: { element: { type: "api-shared" } },
              allow: { to: { element: { type: "api-shared" } } },
            },
          ],
        },
      ],
    },
  },

  {
    files: ["apps/web/**"],
    plugins: { boundaries },
    settings: {
      "boundaries/debug": { enabled: DEBUG_BOUNDARIES },
      "boundaries/root-path": import.meta.dirname,
      /**
       * TypeScript's ESM convention writes `./foo.js` for a file that is `./foo.ts`.
       * The plugin's default (node) resolver cannot follow that, so every internal
       * import resolved to nothing, every dependency was classified `isUnknown`, and
       * the rule had nothing to check — which is precisely how the previous config
       * passed while enforcing nothing.
       */
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: ["apps/*/tsconfig.json", "packages/*/tsconfig.json"],
        },
      },
      "boundaries/elements": [
        { type: "web-feature", pattern: "apps/web/src/features/*/**", capture: ["feature"] },
        { type: "web-shared", pattern: "apps/web/src/shared/**" },
        { type: "web-app", pattern: "apps/web/src/app/**" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message:
            "{{from.element.type}} must not depend on {{to.element.type}} — see TECH-DESIGN.md §2.2.",
          policies: [
            {
              // Rule 6: features never import each other. This is the boundary that
              // stops a 40-file refactor two years in, and the captured-value template
              // is what expresses "itself, and no sibling".
              from: { element: { type: "web-feature" } },
              allow: {
                to: {
                  element: {
                    type: "web-feature",
                    captured: { feature: "{{ from.element.captured.feature }}" },
                  },
                },
              },
            },
            {
              from: { element: { type: "web-feature" } },
              allow: { to: { element: { type: "web-shared" } } },
            },
            {
              // Rule 7: shared/ui is the design system, not a junk drawer. Reaching
              // back into a feature is how it becomes one.
              from: { element: { type: "web-shared" } },
              allow: { to: { element: { type: "web-shared" } } },
            },
            {
              // Routes compose features; that is the whole job of this layer.
              from: { element: { type: "web-app" } },
              allow: {
                to: { element: { type: ["web-app", "web-feature", "web-shared"] } },
              },
            },
          ],
        },
      ],
    },
  },

  // The composition root is the one place the dependency rule must be crossed.
  //
  // A Nest module's entire job is binding abstractions to implementations —
  // `{ provide: MISSION_REPOSITORY, useClass: PrismaMissionRepository }` — which
  // cannot be written without naming the implementation. TECH-DESIGN.md §2.1's own
  // example does exactly this. Clean Architecture exempts the composition root for
  // the same reason.
  //
  // Confined to `*.module.ts`, whose only content is that wiring. A *controller*
  // importing a repository directly is still an error, which is the protection that
  // actually matters — see the controller probe in the commit that added this.
  {
    files: ["apps/*/src/**/*.module.ts"],
    rules: { "boundaries/dependencies": "off" },
  },

  // packages/db talks directly to Prisma's generated client, which Prisma 7
  // builds at runtime via getPrismaClientClass(). eslint's type service cannot
  // follow that construction and reports every call through the client as
  // unsafe; `tsc --noEmit` resolves it correctly and still type-checks these
  // files, so the safety net is intact. Scoped to this package only.
  {
    files: ["packages/db/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },

  // Prisma is confined to infrastructure. Domain and application never see it.
  {
    files: ["apps/api/src/modules/*/{domain,application}/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              message:
                "Prisma belongs in infrastructure/persistence only. Depend on the repository interface instead.",
            },
          ],
        },
      ],
    },
  },

  // Build tooling: plain Node ESM, deliberately outside every tsconfig — these run
  // before and around the build, so they cannot depend on it. Type-aware linting is
  // disabled because there is no project to type them against.
  {
    files: ["scripts/**/*.mjs"],
    ...ts.configs.disableTypeChecked,
    languageOptions: {
      // `disableTypeChecked` switches off the type-aware *rules*, but the parser
      // still demands a project for every file it sees. These belong to none, so the
      // project service is switched off here too.
      parserOptions: { projectService: false, project: false },
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
  },

  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.config.*",
      // Machine-written: type-checked, never linted.
      "**/generated/**",
    ],
  },
]);
