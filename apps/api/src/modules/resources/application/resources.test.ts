import { beforeEach, describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "../../../shared/ids/id-generator.js";
import { FixedClock } from "../../../shared/time/clock.js";
import { ResourceNotFound } from "../domain/errors.js";
import type { Resource } from "../domain/resource.js";
import type { ResourceFilter, ResourceRepository } from "../domain/resource.repository.js";
import {
  AbandonResource,
  AddResource,
  CaptureResource,
  EditResource,
  FinishResource,
  ListResources,
  MarkProgress,
} from "./resource.use-cases.js";
import type { UrlMetadata, UrlMetadataReader } from "./url-metadata.port.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const MISSION = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-05T12:00:00Z");
const LATER = new Date("2026-08-06T09:00:00Z");

class InMemoryResources implements ResourceRepository {
  private readonly byUser = new Map<string, Map<string, Resource>>();
  readonly missionLinks: (string | null | undefined)[] = [];
  saveCount = 0;

  private own(userId: string): Map<string, Resource> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<string, Resource>();
    this.byUser.set(userId, created);
    return created;
  }

  findById(userId: string, id: string): Promise<Resource | null> {
    return Promise.resolve(this.own(userId).get(id) ?? null);
  }

  findByUrl(userId: string, url: string): Promise<Resource | null> {
    return Promise.resolve([...this.own(userId).values()].find((r) => r.url === url) ?? null);
  }

  list(userId: string, filter: ResourceFilter): Promise<Resource[]> {
    let all = [...this.own(userId).values()];
    if (filter.status) all = all.filter((r) => r.status === filter.status);
    if (filter.type) all = all.filter((r) => r.type === filter.type);
    if (filter.limit !== undefined) all = all.slice(0, filter.limit);
    return Promise.resolve(all);
  }

  save(userId: string, resource: Resource, missionId?: string | null): Promise<void> {
    this.saveCount += 1;
    this.missionLinks.push(missionId);
    this.own(userId).set(resource.id, resource);
    return Promise.resolve();
  }
}

/** Records how many times the network was reached, which is the thing FR-R2 is sensitive to. */
class StubMetadata implements UrlMetadataReader {
  calls = 0;
  constructor(private readonly result: UrlMetadata = { title: null, author: null }) {}
  read(): Promise<UrlMetadata> {
    this.calls += 1;
    return Promise.resolve(this.result);
  }
}

describe("CaptureResource (FR-R2)", () => {
  let resources: InMemoryResources;

  beforeEach(() => {
    resources = new InMemoryResources();
  });

  function captureWith(metadata: UrlMetadataReader): CaptureResource {
    return new CaptureResource(
      resources,
      metadata,
      new FixedClock(NOW),
      new SequentialIdGenerator(),
    );
  }

  it("fills in the title and author from the page", async () => {
    const capture = captureWith(
      new StubMetadata({ title: "Understanding Ownership", author: "The Rust Book" }),
    );

    const resource = await capture.execute(ALICE, { url: "https://doc.rust-lang.test/ch04" });

    expect(resource.title).toBe("Understanding Ownership");
    expect(resource.author).toBe("The Rust Book");
  });

  it("guesses the type from the URL rather than asking", async () => {
    // M1's bullet rules out a model call here; a crude guess costs one tap when it is wrong, and a
    // type picker costs a tap every single time.
    const capture = captureWith(new StubMetadata());

    const video = await capture.execute(ALICE, { url: "https://www.youtube.com/watch?v=abc" });
    expect(video.type).toBe("video");

    const paper = await capture.execute(ALICE, { url: "https://arxiv.org/abs/2401.00001" });
    expect(paper.type).toBe("paper");
  });

  it("lands in the inbox, so capture never becomes triage", async () => {
    const resource = await captureWith(new StubMetadata()).execute(ALICE, {
      url: "https://example.test/a",
    });
    expect(resource.status).toBe("inbox");
  });

  describe("when the lookup fails", () => {
    it("keeps the capture and uses the URL as the title", async () => {
      // The worst possible outcome on the most-used path is losing the URL because a title fetch
      // failed. Ugly-but-present beats absent, and correcting it is one tap.
      const resource = await captureWith(new StubMetadata()).execute(ALICE, {
        url: "https://example.test/some-article",
      });

      expect(resource.title).toBe("https://example.test/some-article");
      expect(resource.url).toBe("https://example.test/some-article");
    });

    it("still saves when the reader throws, rather than failing the capture", async () => {
      // The port's contract says it returns nulls, but a future adapter that breaks that contract
      // must not take the capture down with it.
      const throwing: UrlMetadataReader = {
        read: () => Promise.reject(new Error("DNS exploded")),
      };

      await expect(
        captureWith(throwing).execute(ALICE, { url: "https://example.test/a" }),
      ).resolves.toMatchObject({ title: "https://example.test/a" });
    });
  });

  describe("duplicates", () => {
    it("returns the existing resource for a URL already captured", async () => {
      // A library that accumulates three copies of one article is a library you stop trusting.
      const capture = captureWith(new StubMetadata({ title: "A", author: null }));

      const first = await capture.execute(ALICE, { url: "https://example.test/a" });
      const again = await capture.execute(ALICE, { url: "https://example.test/a" });

      expect(again.id).toBe(first.id);
      expect(resources.saveCount).toBe(1);
    });

    it("does not re-read the page for a URL it already has", async () => {
      // A duplicate paste must not cost a network round trip; the capture budget is 5s total.
      const metadata = new StubMetadata({ title: "A", author: null });
      const capture = captureWith(metadata);

      await capture.execute(ALICE, { url: "https://example.test/a" });
      await capture.execute(ALICE, { url: "https://example.test/a" });

      expect(metadata.calls).toBe(1);
    });

    it("does not leave a status change intact on a re-capture", async () => {
      // Pasting a link you already finished must not send it back to the inbox — that would quietly
      // undo a decision.
      const capture = captureWith(new StubMetadata());
      const first = await capture.execute(ALICE, { url: "https://example.test/a" });
      await new FinishResource(resources, new FixedClock(LATER)).execute(ALICE, first.id);

      const again = await capture.execute(ALICE, { url: "https://example.test/a" });
      expect(again.status).toBe("finished");
    });

    it("is idempotent on a replayed client id, so capture rides the offline queue", async () => {
      const capture = captureWith(new StubMetadata());
      const id = "44444444-4444-4444-8444-444444444444";

      const first = await capture.execute(ALICE, { id, url: "https://example.test/a" });
      const replay = await capture.execute(ALICE, { id, url: "https://example.test/b" });

      expect(replay.id).toBe(first.id);
      expect(replay.url).toBe("https://example.test/a");
      expect(resources.saveCount).toBe(1);
    });

    it("keeps two users' captures of the same URL separate", async () => {
      const capture = captureWith(new StubMetadata());

      const alices = await capture.execute(ALICE, { url: "https://example.test/a" });
      const bobs = await capture.execute(BOB, { url: "https://example.test/a" });

      expect(bobs.id).not.toBe(alices.id);
      expect(resources.saveCount).toBe(2);
    });
  });

  describe("when the client already knows", () => {
    it("skips the lookup entirely", async () => {
      // A share-target that carries the title should not make the server go and look it up again.
      const metadata = new StubMetadata({ title: "Fetched", author: "Fetched" });
      const capture = captureWith(metadata);

      const resource = await capture.execute(ALICE, {
        url: "https://example.test/a",
        title: "From the share sheet",
        author: "Someone",
      });

      expect(metadata.calls).toBe(0);
      expect(resource.title).toBe("From the share sheet");
    });

    it("prefers a supplied title over a fetched one", async () => {
      const capture = captureWith(new StubMetadata({ title: "Fetched", author: "Fetched" }));

      const resource = await capture.execute(ALICE, {
        url: "https://example.test/a",
        title: "Mine",
      });
      expect(resource.title).toBe("Mine");
      // Only the title was supplied, so the author still comes from the page.
      expect(resource.author).toBe("Fetched");
    });

    it("honours a supplied type over the guess", async () => {
      const resource = await captureWith(new StubMetadata()).execute(ALICE, {
        url: "https://www.youtube.com/watch?v=abc",
        type: "course",
      });
      expect(resource.type).toBe("course");
    });
  });

  it("links to a mission in the same write when one is given", async () => {
    // Not a second request: a capture made from a mission's screen must not be able to half-succeed.
    await captureWith(new StubMetadata()).execute(ALICE, {
      url: "https://example.test/a",
      missionId: MISSION,
    });
    expect(resources.missionLinks).toEqual([MISSION]);
  });
});

describe("AddResource", () => {
  let resources: InMemoryResources;
  let add: AddResource;

  beforeEach(() => {
    resources = new InMemoryResources();
    add = new AddResource(resources, new FixedClock(NOW), new SequentialIdGenerator());
  });

  it("adds something with no URL, like a paper book", async () => {
    const resource = await add.execute(ALICE, {
      type: "book",
      title: "Programming Rust",
      status: "queued",
    });

    expect(resource.url).toBeNull();
    expect(resource.status).toBe("queued");
    expect(resource.progress).toEqual({ unit: "page", current: 0, total: null });
  });

  it("is idempotent on a replayed id", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    await add.execute(ALICE, { id, type: "book", title: "first", status: "inbox" });
    const replay = await add.execute(ALICE, { id, type: "book", title: "second", status: "inbox" });

    expect(replay.title).toBe("first");
    expect(resources.saveCount).toBe(1);
  });
});

describe("MarkProgress", () => {
  let resources: InMemoryResources;
  let add: AddResource;
  let mark: MarkProgress;

  beforeEach(() => {
    resources = new InMemoryResources();
    add = new AddResource(resources, new FixedClock(NOW), new SequentialIdGenerator());
    mark = new MarkProgress(resources, new FixedClock(LATER));
  });

  async function aBook(): Promise<Resource> {
    return add.execute(ALICE, { type: "book", title: "Programming Rust", status: "inbox" });
  }

  it("records the position and starts the book", async () => {
    const book = await aBook();
    const after = await mark.execute(ALICE, book.id, { current: 137, total: 590 });

    expect(after.progress).toEqual({ unit: "page", current: 137, total: 590 });
    expect(after.status).toBe("active");
  });

  it("converges on the same position when replayed", async () => {
    // Progress is a position, not an event, so it needs no idempotency key — replaying "page 137"
    // twice lands on page 137 either way. This is why the endpoint takes no client id.
    const book = await aBook();
    await mark.execute(ALICE, book.id, { current: 137, total: 590 });
    const replay = await mark.execute(ALICE, book.id, { current: 137, total: 590 });

    expect(replay.progress?.current).toBe(137);
  });

  it("rejects an unknown resource", async () => {
    await expect(
      mark.execute(ALICE, "55555555-5555-4555-8555-555555555555", { current: 1 }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it("reports another user's resource as not found", async () => {
    const book = await aBook();
    await expect(mark.execute(BOB, book.id, { current: 1 })).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe("FinishResource and AbandonResource", () => {
  let resources: InMemoryResources;
  let add: AddResource;

  beforeEach(() => {
    resources = new InMemoryResources();
    add = new AddResource(resources, new FixedClock(NOW), new SequentialIdGenerator());
  });

  async function aBook(): Promise<Resource> {
    return add.execute(ALICE, { type: "book", title: "Programming Rust", status: "active" });
  }

  it("finishes with a timestamp", async () => {
    const book = await aBook();
    const after = await new FinishResource(resources, new FixedClock(LATER)).execute(
      ALICE,
      book.id,
    );

    expect(after.status).toBe("finished");
    expect(after.finishedAt).toEqual(LATER);
  });

  it("abandons with no reason (FR-R5)", async () => {
    const book = await aBook();
    const after = await new AbandonResource(resources, new FixedClock(LATER)).execute(
      ALICE,
      book.id,
      {},
    );

    expect(after.status).toBe("abandoned");
    expect(after.abandonReason).toBeNull();
  });

  it("keeps a reason when one is given", async () => {
    const book = await aBook();
    const after = await new AbandonResource(resources, new FixedClock(LATER)).execute(
      ALICE,
      book.id,
      { reason: "too shallow" },
    );
    expect(after.abandonReason).toBe("too shallow");
  });

  it("reports another user's resource as not found on both", async () => {
    const book = await aBook();
    await expect(
      new FinishResource(resources, new FixedClock(LATER)).execute(BOB, book.id),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      new AbandonResource(resources, new FixedClock(LATER)).execute(BOB, book.id, {}),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });
});

describe("EditResource", () => {
  let resources: InMemoryResources;
  let add: AddResource;
  let edit: EditResource;

  beforeEach(() => {
    resources = new InMemoryResources();
    add = new AddResource(resources, new FixedClock(NOW), new SequentialIdGenerator());
    edit = new EditResource(resources, new FixedClock(LATER));
  });

  it("triages an inbox capture into the queue", async () => {
    const captured = await add.execute(ALICE, {
      type: "article",
      title: "x",
      status: "inbox",
    });

    expect((await edit.execute(ALICE, captured.id, { status: "queued" })).status).toBe("queued");
  });

  it("corrects a wrong type guess", async () => {
    const captured = await add.execute(ALICE, { type: "article", title: "x", status: "inbox" });
    const after = await edit.execute(ALICE, captured.id, { type: "video" });

    expect(after.type).toBe("video");
    // Progress follows the type, because a page number on a video means nothing.
    expect(after.progress).toEqual({ unit: "second", current: 0, total: null });
  });

  it("rejects an unknown resource", async () => {
    await expect(
      edit.execute(ALICE, "55555555-5555-4555-8555-555555555555", { title: "x" }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });

  it("reports another user's resource as not found", async () => {
    const captured = await add.execute(ALICE, { type: "article", title: "x", status: "inbox" });
    await expect(edit.execute(BOB, captured.id, { title: "hijacked" })).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe("ListResources", () => {
  let resources: InMemoryResources;
  let add: AddResource;

  beforeEach(() => {
    resources = new InMemoryResources();
    add = new AddResource(resources, new FixedClock(NOW), new SequentialIdGenerator());
  });

  it("filters by status, which is how the inbox is read", async () => {
    await add.execute(ALICE, { type: "article", title: "untriaged", status: "inbox" });
    await add.execute(ALICE, { type: "book", title: "reading", status: "active" });

    const inbox = await new ListResources(resources).execute(ALICE, { status: "inbox" });
    expect(inbox.map((r) => r.title)).toEqual(["untriaged"]);
  });

  it("caps the list, because M2 owns the paged backlog view", async () => {
    for (let i = 0; i < 250; i += 1) {
      await add.execute(ALICE, { type: "article", title: `a ${i}`, status: "inbox" });
    }
    await expect(new ListResources(resources).execute(ALICE, {})).resolves.toHaveLength(200);
  });

  it("never lists another user's resources", async () => {
    await add.execute(ALICE, { type: "book", title: "alice's", status: "inbox" });
    await expect(new ListResources(resources).execute(BOB, {})).resolves.toEqual([]);
  });
});
