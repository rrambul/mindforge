import { renderBriefing } from "@mindforge/workspace";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";

import { BRIEFING_READER, TeachRuns, type BriefingReader } from "@mindforge/api/teach";

import { ENV, type Env } from "../../../shared/env.js";
import { TEACH_DISPATCH_GATEWAY, type TeachDispatchGateway } from "../application/dispatch.port.js";
import { TeachRun } from "../application/teach-run.js";

/**
 * What picks a queued run up and runs it.
 *
 * A second self-rescheduling `setTimeout`, like `NightlyScheduler` — there is no
 * Redis and no queue (§10), and the two loops are deliberately separate because
 * their periods differ by three orders of magnitude: the nightly job wakes every
 * fifteen minutes, and somebody pressing "teach me the next thing" should not
 * wait that long.
 *
 * **One run at a time in this process**, on top of the one-per-mission index. The
 * index stops two runs colliding on a workspace; this stops one worker starting
 * six agent subprocesses at once, each of which wants about a gigabyte. Without
 * it a user with six missions can OOM the container by pressing a button six
 * times.
 */

/** Short, because this is the latency between pressing a button and something happening. */
const POLL_MS = 5_000;

@Injectable()
export class TeachDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TeachDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private busy = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(TEACH_DISPATCH_GATEWAY) private readonly gateway: TeachDispatchGateway,
    @Inject(BRIEFING_READER) private readonly briefings: BriefingReader,
    private readonly runs: TeachRuns,
    private readonly teach: TeachRun,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === "test") return;
    this.logger.log(`Teach dispatcher polling every ${POLL_MS}ms`);
    void this.tick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      // The reaper runs on the same tick rather than on its own timer: it is two
      // queries, and a mission wedged behind a dead worker should free up in
      // seconds rather than at the next nightly.
      const reaped = await this.runs.reapStale();
      if (reaped.length > 0) {
        this.logger.warn(`Reaped ${reaped.length} run(s) whose worker stopped reporting`);
      }

      if (!this.busy) await this.dispatchOne();
    } catch (error) {
      // The loop must survive anything, for the reason `NightlyScheduler` gives:
      // a scheduler that stops on its first bad tick is one whose failure is
      // invisible until somebody notices nothing has been taught in a fortnight.
      this.logger.error(
        `Teach tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => void this.tick(), POLL_MS);
    }
  }

  private async dispatchOne(): Promise<void> {
    const queued = await this.gateway.nextQueued();
    if (!queued) return;

    // Compare-and-swap. Two workers — or a restart racing itself — both see
    // `queued`, and only one can claim.
    const claimed = await this.runs.claim(queued.userId, queued.id);
    if (!claimed) return;

    this.busy = true;
    try {
      const briefing = renderBriefing(await this.briefings.gather(queued.userId, queued.missionId));
      const plugin = await this.gateway.writePlugin(queued.id);

      const outcome = await this.teach.execute({
        runId: queued.id,
        userId: queued.userId,
        missionId: queued.missionId,
        workspaceKey: queued.workspaceKey,
        briefing,
        pluginDir: plugin.path,
        skillRef: plugin.skillRef,
        timezone: queued.timezone,
      });

      this.logger.log(
        `Teach run ${queued.id}: ${outcome.status}, ${outcome.lessonsWritten.length} lesson(s)`,
      );
    } finally {
      this.busy = false;
    }
  }
}
