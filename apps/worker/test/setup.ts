// Prisma 7 no longer auto-loads .env, and these tests need a real connection plus
// a real Storage endpoint. Mirrors packages/db/test/setup.ts.
try {
  process.loadEnvFile(new URL("../../../.env.local", import.meta.url).pathname);
} catch {
  // CI provides the environment directly.
}
