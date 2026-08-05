// The integration suite talks to the real local stack, so it needs the same
// connection strings the apps read. Absence is not an error: CI provides the
// environment directly, and `loadEnv` is what fails loudly if something is missing.
//
// This file lives in apps/api/test/, so the workspace root is three levels up.
for (const candidate of ["../../../.env.local", "../../.env"]) {
  try {
    process.loadEnvFile(new URL(candidate, import.meta.url).pathname);
    break;
  } catch {
    // Next candidate.
  }
}
