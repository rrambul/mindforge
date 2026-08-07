import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./app.module.js";

/**
 * Prisma 7 does not auto-load `.env`, and unlike the API nothing else in this process does it
 * either — so without this the worker boots straight into "Invalid environment. Check: DATABASE_URL"
 * on a machine where the file is right there.
 */
function loadLocalEnvFile(): void {
  // Relative to this file, which sits at apps/worker/src/ — so three levels up is the repo root.
  for (const candidate of ["../../../.env.local", "../../../packages/db/.env"]) {
    try {
      process.loadEnvFile(new URL(candidate, import.meta.url).pathname);
      return;
    } catch {
      // Next candidate. In CI and on Railway the environment is already populated and neither file
      // exists, which is not an error.
    }
  }
}

async function bootstrap(): Promise<void> {
  loadLocalEnvFile();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // drain in-flight jobs on SIGTERM before exiting
  await app.init();
  // Nothing awaits here on purpose. The scheduler's timer holds the event loop open; before it
  // existed this function returned and the process exited 0 in under 100ms, which on a platform
  // that restarts on exit is a crash loop that reports success.
}

void bootstrap();
