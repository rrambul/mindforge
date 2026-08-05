// Prisma 7 no longer auto-loads .env, and these tests need a real connection.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  // CI provides the environment directly.
}
