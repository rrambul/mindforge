import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // drain in-flight jobs on SIGTERM before exiting
  await app.init();
}

void bootstrap();
