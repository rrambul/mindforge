import {
  guessTypeFromUrl,
  type AbandonResourceInput,
  type CaptureResourceInput,
  type CreateResourceInput,
  type ListResourcesQuery,
  type UpdateProgressInput,
  type UpdateResourceInput,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { ResourceNotFound } from "../domain/errors.js";
import { Resource } from "../domain/resource.js";
import { RESOURCE_REPOSITORY, type ResourceRepository } from "../domain/resource.repository.js";
import { URL_METADATA, type UrlMetadata, type UrlMetadataReader } from "./url-metadata.port.js";

const NO_METADATA: UrlMetadata = { title: null, author: null };

/**
 * FR-R2 — paste a URL and the server fills in the rest. The make-or-break feature.
 *
 * Three things make it feel frictionless rather than merely short:
 *
 * The **same URL twice is the same resource**, not a duplicate. You will paste something you already
 * have, and a library that accumulates three copies of one article is a library you stop trusting.
 *
 * **Metadata failure is not capture failure.** The URL is the thing worth keeping; if the fetch times
 * out or the page has no OpenGraph tags, the resource is saved with the URL as its title and you can
 * correct it in one tap. Losing the capture because a title lookup failed would be the worst possible
 * outcome on the most-used path.
 *
 * **The type is guessed, never asked.** `guessTypeFromUrl` is deliberately crude and deliberately not
 * a model call — M1's bullet says no model here, and a wrong guess costs one tap.
 */
@Injectable()
export class CaptureResource {
  constructor(
    @Inject(RESOURCE_REPOSITORY) private readonly resources: ResourceRepository,
    @Inject(URL_METADATA) private readonly metadata: UrlMetadataReader,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(userId: string, input: CaptureResourceInput): Promise<Resource> {
    if (input.id) {
      const byId = await this.resources.findById(userId, input.id);
      if (byId) return byId;
    }

    const existing = await this.resources.findByUrl(userId, input.url);
    if (existing) return existing;

    // Only fetched when the client has not already supplied both. A share-target that knows the
    // title should not make the server go and look it up again.
    const needsLookup = input.title === undefined || input.author === undefined;
    const found = needsLookup ? await this.lookUp(input.url) : NO_METADATA;

    const resource = Resource.add({
      id: input.id ?? this.ids.next(),
      userId,
      type: input.type ?? guessTypeFromUrl(input.url),
      // The URL itself is the fallback title. Ugly, and far better than an empty row or a failure:
      // it is recognisable enough to correct and it keeps the capture.
      title: input.title ?? found.title ?? input.url,
      author: input.author ?? found.author ?? null,
      url: input.url,
      // FR-R2: an inbox for uncategorised captures, triaged later.
      status: "inbox",
      now: this.clock.now(),
    });

    await this.resources.save(userId, resource, input.missionId ?? null);
    return resource;
  }

  /**
   * The port's contract is that it returns nulls rather than throwing, and the shipped adapter
   * honours it. Belt and braces anyway: this is the one call on the product's most-used path that
   * touches the network, and an adapter that breaks the contract must degrade the capture's title
   * rather than lose the capture.
   */
  private async lookUp(url: string): Promise<UrlMetadata> {
    try {
      return await this.metadata.read(url);
    } catch {
      return NO_METADATA;
    }
  }
}

/** Adding something with no URL — a paper book, a course you are enrolled in. */
@Injectable()
export class AddResource {
  constructor(
    @Inject(RESOURCE_REPOSITORY) private readonly resources: ResourceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(userId: string, input: CreateResourceInput): Promise<Resource> {
    if (input.id) {
      const existing = await this.resources.findById(userId, input.id);
      if (existing) return existing;
    }

    const resource = Resource.add({
      id: input.id ?? this.ids.next(),
      userId,
      type: input.type,
      title: input.title,
      author: input.author ?? null,
      url: input.url ?? null,
      status: input.status,
      now: this.clock.now(),
    });

    await this.resources.save(userId, resource, input.missionId ?? null);
    return resource;
  }
}

@Injectable()
export class EditResource {
  constructor(
    @Inject(RESOURCE_REPOSITORY) private readonly resources: ResourceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string, input: UpdateResourceInput): Promise<Resource> {
    const resource = await this.load(userId, id);
    resource.edit(
      {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.author === undefined ? {} : { author: input.author }),
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
      this.clock.now(),
    );
    await this.resources.save(userId, resource);
    return resource;
  }

  private async load(userId: string, id: string): Promise<Resource> {
    const resource = await this.resources.findById(userId, id);
    if (!resource) throw new ResourceNotFound(id);
    return resource;
  }
}

/**
 * A capture path (§5.1): you finish a chapter in bed and update it there.
 *
 * Not idempotent on an id, unlike the other captures, and that is correct: progress is a *position*
 * rather than an event, so replaying "page 137" twice lands on page 137 either way. The write is
 * naturally idempotent without needing a key.
 */
@Injectable()
export class MarkProgress {
  constructor(
    @Inject(RESOURCE_REPOSITORY) private readonly resources: ResourceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string, input: UpdateProgressInput): Promise<Resource> {
    const resource = await this.resources.findById(userId, id);
    if (!resource) throw new ResourceNotFound(id);

    resource.markProgress(input.current, input.total, this.clock.now());
    await this.resources.save(userId, resource);
    return resource;
  }
}

@Injectable()
export class FinishResource {
  constructor(
    @Inject(RESOURCE_REPOSITORY) private readonly resources: ResourceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string): Promise<Resource> {
    const resource = await this.resources.findById(userId, id);
    if (!resource) throw new ResourceNotFound(id);

    resource.finish(this.clock.now());
    await this.resources.save(userId, resource);
    return resource;
  }
}

@Injectable()
export class AbandonResource {
  constructor(
    @Inject(RESOURCE_REPOSITORY) private readonly resources: ResourceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string, input: AbandonResourceInput): Promise<Resource> {
    const resource = await this.resources.findById(userId, id);
    if (!resource) throw new ResourceNotFound(id);

    resource.abandon(input.reason ?? null, this.clock.now());
    await this.resources.save(userId, resource);
    return resource;
  }
}

/** Bounded, but generously: a library is browsed, and the backlog view (M2) will page properly. */
const DEFAULT_LIMIT = 200;

@Injectable()
export class ListResources {
  constructor(@Inject(RESOURCE_REPOSITORY) private readonly resources: ResourceRepository) {}

  execute(userId: string, query: ListResourcesQuery): Promise<Resource[]> {
    return this.resources.list(userId, { ...query, limit: DEFAULT_LIMIT });
  }
}
