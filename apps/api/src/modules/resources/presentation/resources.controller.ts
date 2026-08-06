import {
  AbandonResourceSchema,
  CaptureResourceSchema,
  CreateResourceSchema,
  ListResourcesQuerySchema,
  SetResourceLinksSchema,
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
  type SetResourceLinksInput,
  type UpdateProgressInput,
  type UpdateResourceInput,
} from "@mindforge/core";
import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
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
  ReadResourceLinks,
  SetResourceLinks,
} from "../application/resource.use-cases.js";
import type { Resource } from "../domain/resource.js";
import type { ResourceLinks } from "../domain/resource.repository.js";

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
  /** What this resource is connected to (FR-R3). Empty rather than null: "none" is a set. */
  readonly missionIds: readonly string[];
  readonly skillIds: readonly string[];
  readonly addedAt: string;
  readonly finishedAt: string | null;
}

export function toResourceView(
  resource: Resource,
  links: ResourceLinks = { missionIds: [], skillIds: [] },
): ResourceView {
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
    missionIds: links.missionIds,
    skillIds: links.skillIds,
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
    private readonly setLinks: SetResourceLinks,
    private readonly readLinks: ReadResourceLinks,
  ) {}

  /** Reads one resource's links, so every single-resource response carries them too. */
  private async viewOf(userId: string, resource: Resource): Promise<ResourceView> {
    const links = await this.readLinks.read(userId, [resource]);
    return toResourceView(resource, links[resource.id]);
  }

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
    // One batched read for every card on the screen rather than one per resource.
    const links = await this.readLinks.read(user.userId, ordered);
    return { resources: ordered.map((resource) => toResourceView(resource, links[resource.id])) };
  }

  /** FR-R2. Paste a URL; the server does the rest. */
  @Post("capture")
  async captureUrl(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CaptureResourceSchema)) body: CaptureResourceInput,
  ): Promise<ResourceView> {
    return this.viewOf(user.userId, await this.capture.execute(user.userId, body));
  }

  @Post()
  async create(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CreateResourceSchema)) body: CreateResourceInput,
  ): Promise<ResourceView> {
    return this.viewOf(user.userId, await this.add.execute(user.userId, body));
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(UpdateResourceSchema)) body: UpdateResourceInput,
  ): Promise<ResourceView> {
    return this.viewOf(user.userId, await this.edit.execute(user.userId, id, body));
  }

  @Patch(":id/progress")
  async markProgress(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(UpdateProgressSchema)) body: UpdateProgressInput,
  ): Promise<ResourceView> {
    return this.viewOf(user.userId, await this.progress.execute(user.userId, id, body));
  }

  @Post(":id/finish")
  async markFinished(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<ResourceView> {
    return this.viewOf(user.userId, await this.finish.execute(user.userId, id));
  }

  /**
   * FR-R3 — what this resource is for.
   *
   * `PUT` rather than `POST`, because it replaces the whole set: sending it twice leaves the same
   * links, and a client that lost track of what was attached cannot half-apply a diff.
   */
  @Put(":id/links")
  async setResourceLinks(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(SetResourceLinksSchema)) body: SetResourceLinksInput,
  ): Promise<ResourceView> {
    return this.viewOf(user.userId, await this.setLinks.execute(user.userId, id, body));
  }

  /** FR-R5 — guilt-free, and the reason is optional. */
  @Post(":id/abandon")
  async markAbandoned(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(AbandonResourceSchema)) body: AbandonResourceInput,
  ): Promise<ResourceView> {
    return this.viewOf(user.userId, await this.abandon.execute(user.userId, id, body));
  }
}
