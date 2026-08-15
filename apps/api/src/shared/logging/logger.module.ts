import { Module, type DynamicModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";

import { ENV, type Env } from "../config/env.js";
import { pinoHttpOptions } from "./pino-options.js";
import { RequestLogContextInterceptor } from "./request-log-context.interceptor.js";

/**
 * Structured request logging.
 *
 * `pino` and `nestjs-pino` were dependencies of this app for three milestones and
 * were imported by nothing: the API emitted Nest's default console lines, with no
 * request log, no request id, and no way to tie a line to the user it belonged to.
 * Survivable on one laptop; not survivable the first time an eight-minute teach
 * run fails in a container.
 *
 * Three decisions live here; the rest are in `pino-options.ts`, on the fields they
 * govern.
 *
 * 1. **JSON in every environment, including development.** The pretty-printer is a
 *    separate package that runs in a worker thread, and enabling it on
 *    `NODE_ENV === "development"` would make it load in any container whose
 *    NODE_ENV was unset — `env.ts` defaults that value, so the crash would be at
 *    boot, in production, over a formatter. `pnpm dev | npx pino-pretty` costs a
 *    pipe and cannot fail that way.
 *
 * 2. **The user is attached by an interceptor, not by `customProps`.** Under the
 *    Fastify adapter `pino-http` sees the *raw* `IncomingMessage`, while the auth
 *    guard keys its `WeakMap` on Fastify's request wrapper — so `customProps` would
 *    look the user up on the wrong object and find nothing, forever, silently.
 *
 * 3. **`assignResponse`, so the completion line carries the user too.** Without it,
 *    "whose request was this" is answerable only for requests where something
 *    inside the handler happened to log.
 */
@Module({})
export class LoggingModule {
  static forRoot(): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        PinoLoggerModule.forRootAsync({
          inject: [ENV],
          useFactory: (env: Env) => ({
            pinoHttp: pinoHttpOptions(env),
            assignResponse: true,
          }),
        }),
      ],
      providers: [{ provide: APP_INTERCEPTOR, useClass: RequestLogContextInterceptor }],
    };
  }
}
