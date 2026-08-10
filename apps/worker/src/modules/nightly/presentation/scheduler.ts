import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ENV, type Env } from "../../../shared/env.js";
import { NightlyRun } from "../application/nightly-run.js";

/**
 * What actually makes the nightly jobs happen — and what keeps the process alive.
 *
 * **Why a timer and not BullMQ.** TECH-DESIGN §2 names BullMQ + Redis as the queue, and `bullmq` is
 * a declared dependency of both this app and the API. It is imported by nothing, and there is no
 * Redis: not locally, not in CI, not in `supabase/config.toml`, not in a compose file, not on
 * Railway — which is itself unprovisioned. `BullModule.forRoot()` would fail at boot with
 * ECONNREFUSED, and BullMQ's repeatable-job state lives *in* Redis, so there would be nothing to
 * schedule against even if it started. This is the smallest correct thing that can be built from
 * what exists.
 *
 * The shape is chosen so the swap is local when Redis lands: the tick becomes
 * `queue.add(name, data, { jobId: \`\${userId}:\${localDay}\` })` and `NightlyRun` is untouched,
 * because the idempotency that makes both safe already lives in Postgres — a `daily_activity` upsert
 * over `(user_id, day)` and a unique `(user_id, dedupe_key)` on notifications — rather than in the
 * scheduler. That is the property worth keeping, and BullMQ's `jobId` would only be a second layer
 * over it.
 *
 * **`setTimeout` rescheduled after each run, not `setInterval`.** An interval fires on a fixed
 * cadence regardless of how long the previous tick took, so a slow run overlaps the next one — and
 * two nightly runs interleaving over the same user is the one thing the whole design tries to make
 * impossible. Rescheduling after completion cannot overlap by construction.
 *
 * **The timer is not `unref`'d**, which is load-bearing in a second way: it is the only thing
 * holding the event loop open. Before this file existed the worker printed
 * "dependencies initialized" and exited 0 in under 100ms — a deployed container that would have been
 * a restart loop reporting success.
 */
@Injectable()
export class NightlyScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NightlyScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly run: NightlyRun,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log(`Nightly scheduler ticking every ${this.env.SCHEDULER_TICK_MS}ms`);
    // Runs immediately rather than after the first interval. A worker restarted at 09:00 should
    // catch up on the night it missed, not wait until 09:15 to find out it missed one.
    void this.tick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const outcome = await this.run.execute();
      if (outcome.rolledUp > 0 || outcome.failures > 0) {
        this.logger.log(
          `Nightly: ${outcome.rolledUp} rolled up, ${outcome.failures} failed, ` +
            `across ${outcome.profilesSeen} profiles`,
        );
      }
    } catch (error) {
      // The loop must survive anything — a dropped connection, a migration mid-deploy. A scheduler
      // that stops on its first bad tick is one whose failure is invisible until somebody notices
      // the grid has not moved in a fortnight.
      this.logger.error(
        `Nightly tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.tick(), this.env.SCHEDULER_TICK_MS);
      }
    }
  }
}
