import {
  AbandonResourceSchema,
  CaptureResourceSchema,
  CreateResourceSchema,
  ListResourcesQuerySchema,
  UpdateProgressSchema,
  UpdateResourceSchema,
  UuidSchema,
  progressFraction,
  resourceStatusRank,
  type AbandonResourceInput,
  type CaptureResourceInput,
  type CreateResourceInput,
  type ListResourcesQuery,
  type ResourceProgress,
  type ResourceStatus,
  type ResourceType,
  type UpdateProgressInput,
  type UpdateResourceInput,
} from "@mindforge/core";
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  AbandonResource,
  AddResource,
  CaptureResource,
  EditResource,
  FinishResource,
  ListResources,
  MarkProgress,
} from "../application/resource.use-cases.js";
import type { Resource } from "../domain/resource.js";

export interface ResourceView {
  readonly id: string;
  readonly type: ResourceType;
  readonly title: string;
  readonly author: string | null;
  readonly url: string | null;
  readonly status: ResourceStatus;
  readonly abandonReason: string | null;
  readonly progress: ResourceProgress | null;
  /** Null when it cannot be computed — never 0, which would be a different and false claim. */
  readonly fraction: number | null;
  /** Whether this kind of thing is measured at all, so the client renders the right control. */
  readonly isMeasurable: boolean;
  readonly addedAt: string;
  readonly finishedAt: string | null;
}

export function toResourceView(resource: Resource): ResourceView {
  const r = resource.toSnapshot();
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    author: r.author,
    url: r.url,
    status: r.status,
    abandonReason: r.abandonReason,
    progress: r.progress,
    fraction: progressFraction(r.progress),
    isMeasurable: resource.isMeasurable,
    addedAt: r.addedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

/**
 * `/v1/resources` (§6).
 *
 * `capture` is the endpoint that matters (FR-R2). Everything else is triage, and triage is allowed to
 * take more than one tap because it happens when you have the attention for it.
 */
@Controller("resources")
export class ResourcesController {
  constructor(
    private readonly capture: CaptureResource,
    private readonly add: AddResource,
    private readonly edit: EditResource,
    private readonly progress: MarkProgress,
    private readonly finish: FinishResource,
    private readonly abandon: AbandonResource,
    private readonly list: ListResources,
  ) {}

  @Get()
  async listResources(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(ListResourcesQuerySchema)) query: ListResourcesQuery,
  ): Promise<{ resources: ResourceView[] }> {
    const resources = await this.list.execute(user.userId, query);
    // Sorted here rather than in SQL: `status` is a text column, so ordering it in Postgres is
    // alphabetical — `abandoned` first — which is the same trap missions fell into. Array#sort is
    // stable, so recency survives within each status.
    const ordered = [...resources].sort(
      (a, b) => resourceStatusRank(a.status) - resourceStatusRank(b.status),
    );
    return { resources: ordered.map(toResourceView) };
  }

  /** FR-R2. Paste a URL; the server does the rest. */
  @Post("capture")
  async captureUrl(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CaptureResourceSchema)) body: CaptureResourceInput,
  ): Promise<ResourceView> {
    return toResourceView(await this.capture.execute(user.userId, body));
  }

  @Post()
  async create(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CreateResourceSchema)) body: CreateResourceInput,
  ): Promise<ResourceView> {
    return toResourceView(await this.add.execute(user.userId, body));
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(UpdateResourceSchema)) body: UpdateResourceInput,
  ): Promise<ResourceView> {
    return toResourceView(await this.edit.execute(user.userId, id, body));
  }

  @Patch(":id/progress")
  async markProgress(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(UpdateProgressSchema)) body: UpdateProgressInput,
  ): Promise<ResourceView> {
    return toResourceView(await this.progress.execute(user.userId, id, body));
  }

  @Post(":id/finish")
  async markFinished(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<ResourceView> {
    return toResourceView(await this.finish.execute(user.userId, id));
  }

  /** FR-R5 — guilt-free, and the reason is optional. */
  @Post(":id/abandon")
  async markAbandoned(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(AbandonResourceSchema)) body: AbandonResourceInput,
  ): Promise<ResourceView> {
    return toResourceView(await this.abandon.execute(user.userId, id, body));
  }
}
