import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.setGlobalPrefix("v1");
  app.enableCors({ origin: process.env["APP_ORIGIN"] ?? "http://localhost:5173", credentials: true });
  await app.listen(Number(process.env["PORT"] ?? 3000), "0.0.0.0");
}

void bootstrap();
