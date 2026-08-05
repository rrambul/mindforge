import { describe, expect, it } from "vitest";
import {
  AbandonResourceSchema,
  CaptureResourceSchema,
  CreateResourceSchema,
  guessTypeFromUrl,
  initialProgress,
  progressFraction,
  RESOURCE_STATUS_ORDER,
  RESOURCE_STATUSES,
  RESOURCE_TYPES,
  ResourceProgressSchema,
  resourceStatusRank,
  UNIT_FOR_TYPE,
  UpdateProgressSchema,
  UpdateResourceSchema,
} from "./resource.js";

describe("CaptureResourceSchema", () => {
  it("needs only a URL — the make-or-break path (FR-R2)", () => {
    // "Minimum: paste-a-URL auto-fetches title/author/type/reading time." Requiring anything else
    // here would defeat the point.
    expect(CaptureResourceSchema.parse({ url: "https://example.com/a" }).url).toBe(
      "https://example.com/a",
    );
  });

  it("accepts corrections alongside the URL", () => {
    // So a wrong guess costs one tap in the same request rather than a second round trip.
    const parsed = CaptureResourceSchema.parse({
      url: "https://example.com/a",
      title: "  The Real Title  ",
      type: "paper",
    });
    expect(parsed.title).toBe("The Real Title");
    expect(parsed.type).toBe("paper");
  });

  it("rejects something that is not a URL", () => {
    expect(CaptureResourceSchema.safeParse({ url: "not a url" }).success).toBe(false);
    expect(CaptureResourceSchema.safeParse({ url: "" }).success).toBe(false);
  });
});

describe("CreateResourceSchema", () => {
  it("takes a resource with no URL, like a paper book", () => {
    const parsed = CreateResourceSchema.parse({ type: "book", title: "Programming Rust" });
    expect(parsed.status).toBe("inbox");
    expect(parsed.url).toBeUndefined();
  });

  it("requires a type and a title when there is no URL to derive them from", () => {
    expect(CreateResourceSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(CreateResourceSchema.safeParse({ type: "book" }).success).toBe(false);
    expect(CreateResourceSchema.safeParse({ type: "book", title: "  " }).success).toBe(false);
  });

  it("lands in the inbox by default (FR-R2)", () => {
    // Capture is frictionless; triage happens later when you have the attention for it.
    expect(CreateResourceSchema.parse({ type: "book", title: "x" }).status).toBe("inbox");
  });
});

describe("UNIT_FOR_TYPE", () => {
  it("measures each type the way FR-R1 describes", () => {
    expect(UNIT_FOR_TYPE.book).toBe("page");
    expect(UNIT_FOR_TYPE.course).toBe("module");
    expect(UNIT_FOR_TYPE.podcast).toBe("second");
    expect(UNIT_FOR_TYPE.video).toBe("second");
  });

  it("gives an article and docs no progress unit", () => {
    // An article is read or not, and reference material is returned to rather than completed —
    // inventing a percentage for either would be a number nobody could act on.
    expect(UNIT_FOR_TYPE.article).toBe("none");
    expect(UNIT_FOR_TYPE.docs).toBe("none");
  });

  it("covers every type, so the UI can never offer the wrong control", () => {
    // A missing entry would render a page number for a podcast.
    for (const type of RESOURCE_TYPES) {
      expect(UNIT_FOR_TYPE[type], type).toBeTruthy();
    }
  });
});

describe("ResourceProgressSchema", () => {
  it("accepts a position with a known total", () => {
    expect(ResourceProgressSchema.parse({ unit: "page", current: 137, total: 590 })).toEqual({
      unit: "page",
      current: 137,
      total: 590,
    });
  });

  it("accepts a position with no total", () => {
    // An audiobook whose length you never checked still has a position.
    expect(
      ResourceProgressSchema.parse({ unit: "second", current: 1420, total: null }).total,
    ).toBeNull();
  });

  it("refuses a position beyond the total", () => {
    expect(
      ResourceProgressSchema.safeParse({ unit: "page", current: 600, total: 590 }).success,
    ).toBe(false);
  });

  it("accepts a position exactly at the total, which is finishing it", () => {
    expect(
      ResourceProgressSchema.safeParse({ unit: "page", current: 590, total: 590 }).success,
    ).toBe(true);
  });

  it("refuses a negative position", () => {
    expect(ResourceProgressSchema.safeParse({ unit: "page", current: -1 }).success).toBe(false);
  });
});

describe("UpdateProgressSchema", () => {
  it("takes just the position, because you mark it as you close the book", () => {
    expect(UpdateProgressSchema.parse({ current: "137" }).current).toBe(137);
  });

  it("lets the total arrive later, once you have looked", () => {
    expect(UpdateProgressSchema.parse({ current: 137, total: 590 }).total).toBe(590);
  });
});

describe("AbandonResourceSchema", () => {
  it("does not require a reason (FR-R5)", () => {
    // Requiring a justification to stop reading something turns quitting into a confession, and the
    // predictable result is items that sit in `active` forever — worse data than a bare abandonment.
    expect(AbandonResourceSchema.parse({})).toEqual({});
  });

  it("keeps a reason when given, because it is prime friction data", () => {
    expect(AbandonResourceSchema.parse({ reason: "  too shallow  " }).reason).toBe("too shallow");
  });
});

describe("UpdateResourceSchema", () => {
  it("rejects a body that changes nothing", () => {
    expect(UpdateResourceSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a single field", () => {
    expect(UpdateResourceSchema.parse({ status: "active" }).status).toBe("active");
  });
});

describe("RESOURCE_STATUS_ORDER", () => {
  it("puts what you are reading first and what is over last", () => {
    expect(resourceStatusRank("active")).toBeLessThan(resourceStatusRank("queued"));
    expect(resourceStatusRank("queued")).toBeLessThan(resourceStatusRank("finished"));
    expect(resourceStatusRank("finished")).toBeLessThan(resourceStatusRank("abandoned"));
  });

  it("puts the inbox second, because untriaged capture is the thing to act on next", () => {
    expect(resourceStatusRank("inbox")).toBeLessThan(resourceStatusRank("queued"));
  });

  it("covers every status the schema allows", () => {
    // A status with no rank would sort as -1 and jump to the top of the list.
    expect([...RESOURCE_STATUS_ORDER].sort()).toEqual([...RESOURCE_STATUSES].sort());
  });
});

describe("progressFraction", () => {
  it("computes a fraction when the total is known", () => {
    expect(progressFraction({ unit: "page", current: 295, total: 590 })).toBe(0.5);
  });

  it("returns null rather than 0 when the total is unknown", () => {
    // Same honesty rule as a skill with no evidence: "137 pages into something of unknown length"
    // and "no progress" are different claims, and rendering the first as 0% invents a number.
    expect(progressFraction({ unit: "second", current: 1420, total: null })).toBeNull();
    expect(progressFraction({ unit: "page", current: 10 })).toBeNull();
  });

  it("returns null for no progress at all", () => {
    expect(progressFraction(null)).toBeNull();
  });

  it("does not exceed 1, even from a bad row", () => {
    // The schema refuses this, but a hand-edited row can hold it, and a 140% bar reads as a bug in
    // the reader rather than in the data.
    expect(progressFraction({ unit: "page", current: 700, total: 590 })).toBe(1);
  });

  it("returns null for a zero total rather than dividing by it", () => {
    expect(progressFraction({ unit: "page", current: 0, total: 0 })).toBeNull();
  });
});

describe("initialProgress", () => {
  it("makes a captured resource immediately markable", () => {
    expect(initialProgress("book")).toEqual({ unit: "page", current: 0, total: null });
    expect(initialProgress("podcast").unit).toBe("second");
  });
});

describe("guessTypeFromUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abc", "video"],
    ["https://youtu.be/abc", "video"],
    ["https://vimeo.com/12345", "video"],
    ["https://open.spotify.com/episode/abc", "podcast"],
    ["https://podcasts.apple.com/us/podcast/x/id1", "podcast"],
    ["https://arxiv.org/abs/2401.00001", "paper"],
    ["https://example.com/paper.pdf", "paper"],
    ["https://www.coursera.org/learn/rust", "course"],
    ["https://docs.rs/tokio", "docs"],
    ["https://example.com/docs/getting-started", "docs"],
    ["https://someblog.dev/posts/ownership", "article"],
  ])("guesses %s is a %s", (url, expected) => {
    expect(guessTypeFromUrl(url)).toBe(expected);
  });

  it("falls back to article rather than failing", () => {
    // A wrong guess costs one tap to correct; a thrown error costs the capture.
    expect(guessTypeFromUrl("not a url")).toBe("article");
    expect(guessTypeFromUrl("")).toBe("article");
    expect(guessTypeFromUrl("mailto:someone@example.com")).toBe("article");
  });

  it("ignores userinfo and a port when matching the host", () => {
    expect(guessTypeFromUrl("https://user:pw@www.youtube.com:443/watch?v=abc")).toBe("video");
  });

  it("does not match a host that merely contains a known one", () => {
    // `notyoutube.com` and `youtube.com.evil.test` are not YouTube, and a substring check would say
    // they were.
    expect(guessTypeFromUrl("https://notyoutube.com/watch")).toBe("article");
    expect(guessTypeFromUrl("https://youtube.com.evil.test/watch")).toBe("article");
  });

  it("always returns a type the schema accepts", () => {
    for (const url of ["https://x.test", "ftp://x.test/a", "://broken", "https://docs.x.test"]) {
      expect(RESOURCE_TYPES).toContain(guessTypeFromUrl(url));
    }
  });
});
