import { createApp, loadLocalEnvFile } from "./bootstrap.js";
import { ENV, type Env } from "./shared/config/env.js";
import { reportExit } from "./shared/process/report-exit.js";

async function bootstrap(): Promise<void> {
  loadLocalEnvFile();
  reportExit(process);

  const app = await createApp();
  const env = app.get<Env>(ENV);

  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
