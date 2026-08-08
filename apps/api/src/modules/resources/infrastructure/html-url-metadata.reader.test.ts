import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlUrlMetadataReader, isPubliclyRoutable } from "./html-url-metadata.reader.js";

/**
 * Every test here is about one property: **this must never throw**, because a thrown error on this
 * path loses a capture (FR-R2). `fetch` is stubbed rather than reaching the network — non-negotiable
 * 8 rules out live calls, and the failure modes worth testing are the ones that are hard to provoke
 * on purpose anyway.
 */

const reader = new HtmlUrlMetadataReader();
const URL = "https://example.test/article";

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

function respondWith(response: Response | Promise<never>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading tags", () => {
  it("prefers OpenGraph over the title tag", async () => {
    // <title> usually carries a site suffix nobody wants in their library; og:title is the page's
    // intended name.
    respondWith(
      htmlResponse(`
        <html><head>
          <meta property="og:title" content="Understanding Ownership" />
          <title>Understanding Ownership - The Rust Programming Language</title>
        </head><body>x</body></html>`),
    );

    await expect(reader.read(URL)).resolves.toMatchObject({ title: "Understanding Ownership" });
  });

  it("falls back to the title tag when there is no OpenGraph", async () => {
    respondWith(htmlResponse("<html><head><title>A Plain Page</title></head></html>"));
    await expect(reader.read(URL)).resolves.toMatchObject({ title: "A Plain Page" });
  });

  it("reads the author from any of the usual spellings", async () => {
    respondWith(
      htmlResponse(`<head><meta name="author" content="Jane Roe"><title>x</title></head>`),
    );
    await expect(reader.read(URL)).resolves.toMatchObject({ author: "Jane Roe" });
  });

  it("uses the site name as the author when there is no byline", async () => {
    // For a docs page, "The Rust Programming Language" is a more useful author than nothing.
    respondWith(
      htmlResponse(
        `<head><meta property="og:site_name" content="The Rust Book"><title>x</title></head>`,
      ),
    );
    await expect(reader.read(URL)).resolves.toMatchObject({ author: "The Rust Book" });
  });

  it("reads a tag whose attributes are in the other order", async () => {
    // Real pages emit both orders, and a one-directional regex silently misses half of them.
    respondWith(htmlResponse(`<head><meta content="Reversed Order" property="og:title"></head>`));
    await expect(reader.read(URL)).resolves.toMatchObject({ title: "Reversed Order" });
  });

  it("decodes the entities that actually appear in titles", async () => {
    respondWith(
      htmlResponse(
        `<head><title>Rust &amp; Wasm: What&#39;s Next &quot;Really&quot;</title></head>`,
      ),
    );
    await expect(reader.read(URL)).resolves.toMatchObject({
      title: `Rust & Wasm: What's Next "Really"`,
    });
  });

  it("collapses the whitespace of a title spread over lines", async () => {
    respondWith(htmlResponse("<head><title>\n  A Long\n  Title\n</title></head>"));
    await expect(reader.read(URL)).resolves.toMatchObject({ title: "A Long Title" });
  });

  it("truncates a title rather than letting it fail validation", async () => {
    // The schema caps at 300. A fetched title longer than that must degrade, not turn a successful
    // fetch into a 422.
    respondWith(htmlResponse(`<head><title>${"x".repeat(500)}</title></head>`));
    const { title } = await reader.read(URL);
    expect(title).toHaveLength(300);
  });

  it("treats an empty tag as no metadata", async () => {
    // An empty og:title would otherwise become an empty title, which the entity refuses — and the
    // URL is a better fallback than a rejected capture.
    respondWith(
      htmlResponse(`<head><meta property="og:title" content="   "><title> </title></head>`),
    );
    await expect(reader.read(URL)).resolves.toEqual({ title: null, author: null });
  });

  it("ignores tags that appear after </head>", async () => {
    // A body that mentions og:title — in a code sample, say — must not become the title.
    respondWith(
      htmlResponse(`
        <head><title>The Real Title</title></head>
        <body><meta property="og:title" content="From The Body"></body>`),
    );
    await expect(reader.read(URL)).resolves.toMatchObject({ title: "The Real Title" });
  });
});

describe("never failing the capture", () => {
  it("returns nulls when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))),
    );
    await expect(reader.read(URL)).resolves.toEqual({ title: null, author: null });
  });

  it("returns nulls on a non-2xx response", async () => {
    respondWith(new Response("nope", { status: 403, headers: { "content-type": "text/html" } }));
    await expect(reader.read(URL)).resolves.toEqual({ title: null, author: null });
  });

  it("does not decode a PDF or an image as text", async () => {
    // Pure waste, and `guessTypeFromUrl` already knows a .pdf is a paper.
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(reader.read(URL)).resolves.toEqual({ title: null, author: null });
  });

  it("returns nulls for a response with no body", async () => {
    respondWith(new Response(null, { status: 200, headers: { "content-type": "text/html" } }));
    await expect(reader.read(URL)).resolves.toEqual({ title: null, author: null });
  });

  it("returns nulls for a page with no tags at all", async () => {
    respondWith(htmlResponse("<html><body>just text</body></html>"));
    await expect(reader.read(URL)).resolves.toEqual({ title: null, author: null });
  });

  it("returns nulls for a malformed URL rather than throwing", async () => {
    // fetch itself rejects on this; the point is that the caller never sees it.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to parse URL"))),
    );
    await expect(reader.read("not a url")).resolves.toEqual({ title: null, author: null });
  });
});

describe("bounded reading", () => {
  it("stops at </head> instead of downloading the whole page", async () => {
    // A 10MB page costs a few KB: <head> is at the top and nothing below it is wanted.
    let pulled = 0;
    const encoder = new TextEncoder();
    const chunks = [
      "<html><head><title>Early Title</title></head>",
      ...Array.from({ length: 50 }, () => "x".repeat(20_000)),
    ];

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pulled];
        pulled += 1;
        if (chunk === undefined) controller.close();
        else controller.enqueue(encoder.encode(chunk));
      },
    });

    respondWith(new Response(body, { headers: { "content-type": "text/html" } }));

    await expect(reader.read(URL)).resolves.toMatchObject({ title: "Early Title" });
    // Not an exact count — a ReadableStream pre-pulls to fill its queue, so the number is a stream
    // detail. What matters is that it stopped near the top rather than draining all 51 chunks.
    expect(pulled).toBeLessThan(4);
  });

  it("gives up on a head that never closes rather than reading forever", async () => {
    // An unbounded read is how a hostile URL becomes a memory problem.
    const encoder = new TextEncoder();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        // Never emits </head>, and never ends.
        controller.enqueue(
          encoder.encode(pulled === 1 ? "<head><title>T</title>" : "y".repeat(64 * 1024)),
        );
      },
    });

    respondWith(new Response(body, { headers: { "content-type": "text/html" } }));

    await expect(reader.read(URL)).resolves.toMatchObject({ title: "T" });
    // 512KB ceiling at 64KB a chunk, so it stops well short of infinity.
    expect(pulled).toBeLessThan(12);
  });

  it("aborts a slow page instead of holding the request open", async () => {
    // The capture budget is 5s end to end; a page that takes longer is not worth its title.
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = reader.read(URL);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ title: null, author: null });
    vi.useRealTimers();
  });
});

describe("not reaching the internal network (SSRF)", () => {
  // `CaptureResourceSchema` validates that the input is *a* URL and nothing more, so without this the
  // endpoint made the API fetch whatever it was handed on behalf of whoever asked. The body never comes
  // back, but reachability, timing, and any <title> do — enough to map an internal network.

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:54322/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://db/",
    "http://redis.internal/",
    "http://printer.local/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    // Loopback wearing an IPv6 hat. `new URL()` normalises this to `::ffff:7f00:1`, so a
    // dotted-quad check alone never sees it.
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "file:///etc/passwd",
    "gopher://example.test/",
  ])("refuses %s", (url) => {
    expect(isPubliclyRoutable(url)).toBe(false);
  });

  /**
   * Shorthand and non-decimal IPv4, which look like they should walk straight past the guard.
   *
   * `isIpLiteral` matches only four dotted octets, so on the raw string `127.1` has a dot (clearing
   * the bare-hostname rejection), fails the literal test, and would fall through to `return true` —
   * a review flagged exactly that. It does not happen, because WHATWG `URL` normalises every one of
   * these to `127.0.0.1` before `parsed.hostname` is read, and the guard only ever sees the
   * normalised form.
   *
   * Pinned rather than argued: the guard's correctness rests on a parser behaviour nothing in this
   * file states, and a future move to a hand-rolled host parse would silently reopen the hole.
   */
  it.each([
    "http://127.1/",
    "http://127.0.1/",
    "http://127.0.0.1./",
    "http://127.1:54322/",
    // Decimal, hex and octal spellings of the same address.
    "http://2130706433/",
    "http://0x7f000001/",
    "http://017700000001/",
    // And the metadata endpoint in the forms that matter.
    "http://0xa9fea9fe/",
    "http://2852039166/",
  ])("rejects %s, because URL normalises it before the guard sees it", (url) => {
    expect(isPubliclyRoutable(url)).toBe(false);
  });

  it.each([
    "https://example.com/a",
    "http://doc.rust-lang.org/ch04",
    "https://8.8.8.8/",
    "https://172.32.0.1/",
    "https://192.169.1.1/",
    // A genuinely public address, mapped. The check has to decode rather than refuse the whole form.
    "https://[::ffff:8.8.8.8]/",
  ])("allows %s", (url) => {
    expect(isPubliclyRoutable(url)).toBe(true);
  });

  it("does not fetch a refused URL at all", async () => {
    // Not "fetches and discards": the request itself is the leak.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(reader.read("http://169.254.169.254/latest/meta-data/")).resolves.toEqual({
      title: null,
      author: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the capture, treating a refused URL exactly like a timeout", async () => {
    // The URL is still the thing worth saving; only its title is not fetched.
    vi.stubGlobal("fetch", vi.fn());
    await expect(reader.read("http://localhost/")).resolves.toEqual({ title: null, author: null });
  });

  it("re-checks each redirect hop, so a public host cannot forward it inward", async () => {
    // The case a hostname check alone misses entirely: `fetch` following redirects would arrive at
    // 127.0.0.1 having only ever validated the public URL.
    const targets: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        targets.push(input);
        if (input === "https://example.test/redirect") {
          return Promise.resolve(
            new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
          );
        }
        return Promise.resolve(
          new Response("<head><title>Nope</title></head>", {
            headers: { "content-type": "text/html" },
          }),
        );
      }),
    );

    await expect(reader.read("https://example.test/redirect")).resolves.toEqual({
      title: null,
      author: null,
    });
    // The redirect was read and refused; the internal address was never requested.
    expect(targets).toEqual(["https://example.test/redirect"]);
  });

  it("follows a redirect that stays public", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        Promise.resolve(
          input === "https://example.test/a"
            ? new Response(null, { status: 301, headers: { location: "https://example.test/b" } })
            : new Response("<head><title>Moved Here</title></head>", {
                headers: { "content-type": "text/html" },
              }),
        ),
      ),
    );

    await expect(reader.read("https://example.test/a")).resolves.toMatchObject({
      title: "Moved Here",
    });
  });

  it("resolves a relative Location against the current URL", async () => {
    // `Location` is allowed to be relative, and treating it as absolute would simply fail to follow.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        Promise.resolve(
          input === "https://example.test/one/two"
            ? new Response(null, { status: 302, headers: { location: "../three" } })
            : new Response("<head><title>Relative</title></head>", {
                headers: { "content-type": "text/html" },
              }),
        ),
      ),
    );

    await expect(reader.read("https://example.test/one/two")).resolves.toMatchObject({
      title: "Relative",
    });
  });

  it("gives up on a redirect loop rather than following it forever", async () => {
    let hops = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        hops += 1;
        return Promise.resolve(
          new Response(null, { status: 302, headers: { location: "https://example.test/loop" } }),
        );
      }),
    );

    await expect(reader.read("https://example.test/loop")).resolves.toEqual({
      title: null,
      author: null,
    });
    expect(hops).toBeLessThan(10);
  });
});
