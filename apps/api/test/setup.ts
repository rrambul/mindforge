import { fileURLToPath } from "node:url";

// The integration suite talks to the real local stack, so it needs the same
// connection strings the apps read. Absence is not an error: CI provides the
// environment directly, and `loadEnv` is what fails loudly if something is missing.
//
// This file lives in apps/api/test/, so the workspace root is three levels up. Both
// candidates are real paths in this repo — a fallback that cannot exist would make
// "env not loaded" indistinguishable from "env file absent", and the suite would then
// fail later with `DIRECT_URL is not set` instead of here.
//
// fileURLToPath rather than `new URL(...).pathname`, which mis-decodes any
// percent-encodable character in the checkout path.
for (const candidate of ["../../../.env.local", "../../../.env"]) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(candidate, import.meta.url)));
    break;
  } catch {
    // Next candidate.
  }
}

// No live model calls in automated tests (non-negotiable 8). `.env.local` carries a
// real key for local teach runs, and hints are the one path in this app that would
// spend it — so it is removed before anything reads the environment, and the hint
// tests stub the generator instead. Without this line a green hint test would be a
// billed one.
delete process.env["ANTHROPIC_API_KEY"];
