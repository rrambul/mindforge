import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import ts from "typescript-eslint";

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
  // These are enforced, not conventional. A violation is a build failure.
  {
    files: ["apps/api/**", "apps/worker/**", "apps/web/**"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "api-domain", pattern: "apps/api/src/modules/*/domain/**" },
        { type: "api-application", pattern: "apps/api/src/modules/*/application/**" },
        { type: "api-infrastructure", pattern: "apps/api/src/modules/*/infrastructure/**" },
        { type: "api-presentation", pattern: "apps/api/src/modules/*/presentation/**" },
        { type: "web-feature", pattern: "apps/web/src/features/*/**", capture: ["feature"] },
        { type: "web-shared", pattern: "apps/web/src/shared/**" },
        { type: "web-app", pattern: "apps/web/src/app/**" },
        { type: "core", pattern: "packages/core/**" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            // Backend: domain <- application <- {infrastructure, presentation}
            { from: "api-domain", allow: ["api-domain", "core"] },
            { from: "api-application", allow: ["api-domain", "api-application", "core"] },
            {
              from: "api-infrastructure",
              allow: ["api-domain", "api-application", "api-infrastructure", "core"],
            },
            {
              from: "api-presentation",
              allow: ["api-domain", "api-application", "api-presentation", "core"],
            },
            // Frontend: features never import each other.
            {
              from: "web-feature",
              allow: [["web-feature", { feature: "${from.feature}" }], "web-shared", "core"],
            },
            { from: "web-shared", allow: ["web-shared", "core"] },
            { from: "web-app", allow: ["web-app", "web-feature", "web-shared", "core"] },
            { from: "core", allow: ["core"] },
          ],
        },
      ],
    },
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
