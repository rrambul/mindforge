import { Injectable } from "@nestjs/common";
import type { UrlMetadata, UrlMetadataReader } from "../application/url-metadata.port.js";

/**
 * Reads a page's OpenGraph and `<meta>` tags. No model call — M1's bullet is explicit.
 *
 * Every limit here exists because this runs on the product's most-used path and must never be the
 * reason a capture fails:
 *
 * - **A hard timeout.** A slow page cannot hold a request open; the capture proceeds with the URL as
 *   its title.
 * - **A byte ceiling.** `<head>` is at the top, so there is no reason to download a 10MB page — and
 *   an unbounded read is how a hostile URL becomes a memory problem.
 * - **Never throws.** Nulls are the contract. DNS failure, a 500, a PDF, binary content: all of them
 *   are "no metadata", which is a successful capture with a title you correct in one tap.
 */
@Injectable()
export class HtmlUrlMetadataReader implements UrlMetadataReader {
  private static readonly TIMEOUT_MS = 4_000;
  private static readonly MAX_BYTES = 512 * 1024;
  private static readonly MAX_REDIRECTS = 5;

  async read(url: string): Promise<UrlMetadata> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HtmlUrlMetadataReader.TIMEOUT_MS);

    try {
      const response = await this.fetchPublic(url, controller.signal);
      if (response === null || !response.ok) return EMPTY;

      const contentType = response.headers.get("content-type") ?? "";
      // A PDF or an image has no tags to read, and decoding one as text would be pure waste.
      if (!contentType.includes("html")) return EMPTY;

      return parseMetadata(await readCapped(response, HtmlUrlMetadataReader.MAX_BYTES));
    } catch {
      // Deliberately swallowed. See the class note: no failure here may cost the capture.
      return EMPTY;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches a URL only if it addresses the public internet, following redirects by hand.
   *
   * Without this the endpoint is a server-side request forgery: `CaptureResourceSchema` validates that
   * the input is *a* URL and nothing more, so `POST /v1/resources/capture` with
   * `http://169.254.169.254/latest/meta-data/` or `http://localhost:54322/` made the API probe its own
   * network on behalf of whoever asked. The page's body never comes back, but reachability, timing, and
   * any `<title>` do — which is enough to map an internal network.
   *
   * `redirect: "manual"` is the load-bearing part. Checking the hostname and then letting `fetch`
   * follow redirects checks the wrong URL: a public host that answers `302 http://127.0.0.1/` would sail
   * straight through. Each hop is re-checked instead.
   *
   * Returns null rather than throwing, because a refused URL is still a successful capture — the title
   * is simply not fetched, exactly as for a timeout.
   */
  private async fetchPublic(url: string, signal: AbortSignal): Promise<Response | null> {
    let target = url;

    for (let hop = 0; hop <= HtmlUrlMetadataReader.MAX_REDIRECTS; hop += 1) {
      if (!isPubliclyRoutable(target)) return null;

      const response = await fetch(target, {
        signal,
        redirect: "manual",
        headers: {
          // Some sites serve a very different page to something that looks like a crawler, and the
          // title we want is the one a person would see.
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mindforge/1.0 (+https://mindforge.app)",
        },
      });

      if (!isRedirect(response.status)) return response;

      const location = response.headers.get("location");
      if (location === null) return response;

      // Resolved against the current URL, because `Location` is allowed to be relative.
      const next = resolveLocation(target, location);
      if (next === null) return null;
      target = next;
    }

    // More hops than any real page needs; a redirect loop is not worth a title.
    return null;
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveLocation(base: string, location: string): string | null {
  try {
    return new URL(location, base).href;
  } catch {
    return null;
  }
}

/**
 * Whether a URL addresses something on the public internet.
 *
 * Hostname-based, and that is a real limit worth stating: a public name that resolves to a private
 * address (DNS rebinding) still passes, because catching that needs the resolved address at connect
 * time, which `fetch` does not expose. This blocks the whole class of *directly addressed* internal
 * targets — which is what a URL pasted into a capture box actually is — and the cloud metadata
 * endpoints specifically, since those are the ones with something worth taking.
 */
export function isPubliclyRoutable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only the two schemes a web page is served over. `file:`, `gopher:`, and friends have no business
  // here, and some of them read the local disk.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // `.local` is mDNS; `.internal` is the convention several clouds use for their own names.
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  // No dot at all means a bare hostname resolved through internal DNS — `intranet`, `db`, a container
  // name on a shared Docker network.
  if (!host.includes(".") && !isIpLiteral(host)) return false;

  if (isIpLiteral(host)) return isPublicIp(host);

  return true;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function isPublicIp(host: string): boolean {
  // IPv6, including the mapped-IPv4 forms that would otherwise smuggle 127.0.0.1 past the v4 checks.
  if (host.includes(":")) {
    const lower = host.toLowerCase();
    if (lower === "::1" || lower === "::") return false;
    // Link-local (fe80::/10) and unique-local (fc00::/7).
    if (/^fe[89ab]/.test(lower) || /^f[cd]/.test(lower)) return false;

    // IPv4-mapped addresses, which are the interesting ones: `::ffff:127.0.0.1` is loopback wearing an
    // IPv6 hat, and would otherwise walk past every check above. Both spellings have to be handled —
    // `new URL()` normalises the dotted form to hex, so `[::ffff:127.0.0.1]` arrives as `::ffff:7f00:1`
    // and a dotted-quad pattern alone never matches it.
    const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
    if (dotted?.[1]) return isPublicIp(dotted[1]);

    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hex?.[1] && hex[2]) {
      const high = Number.parseInt(hex[1], 16);
      const low = Number.parseInt(hex[2], 16);
      return isPublicIp([high >> 8, high & 0xff, low >> 8, low & 0xff].map(String).join("."));
    }

    return true;
  }

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = octets as [number, number, number, number];

  if (a === 0 || a === 127) return false; // this host, loopback
  if (a === 10) return false; // private
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 169 && b === 254) return false; // link-local — the cloud metadata endpoint lives here
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a >= 224) return false; // multicast and reserved

  return true;
}

const EMPTY: UrlMetadata = { title: null, author: null };

/** Stops reading once `<head>` is certainly past, so a huge page costs a fraction of itself. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;

  try {
    for (;;) {
      // Asserted because this package's `Response.body` resolves to `ReadableStream<any>`, so the
      // chunk arrives untyped and eslint is right to object. The runtime shape is fixed by the
      // platform: a byte stream yields `Uint8Array`.
      const { done, value } = (await reader.read()) as {
        done: boolean;
        value?: Uint8Array;
      };
      if (done || value === undefined) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (bytes >= maxBytes || html.includes("</head>")) break;
    }
  } finally {
    // Cancelled rather than left open: an abandoned response keeps a socket alive.
    await reader.cancel().catch(() => undefined);
  }

  return html;
}

/**
 * Regex rather than a DOM parser, and the trade is deliberate: adding an HTML parser to the API for
 * two attributes is a dependency and an attack surface, while a wrong title costs one tap. OpenGraph
 * is preferred over `<title>` because it is the page's *intended* name — `<title>` often carries a
 * site suffix nobody wants in their library.
 */
function parseMetadata(html: string): UrlMetadata {
  const head = html.split("</head>")[0] ?? html;

  return {
    title:
      metaContent(head, "og:title") ?? metaContent(head, "twitter:title") ?? titleTag(head) ?? null,
    author:
      metaContent(head, "author") ??
      metaContent(head, "article:author") ??
      metaContent(head, "og:site_name") ??
      null,
  };
}

function metaContent(head: string, name: string): string | null {
  // Attribute order varies, so both directions are tried. `property` is OpenGraph's spelling and
  // `name` is everyone else's.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];

  for (const pattern of patterns) {
    const value = clean(pattern.exec(head)?.[1]);
    if (value) return value;
  }
  return null;
}

function titleTag(head: string): string | null {
  return clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]);
}

/** Collapses whitespace, decodes the handful of entities that appear in real titles, and caps length. */
function clean(value: string | undefined): string | null {
  if (value === undefined) return null;

  const text = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;|&#x0*27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .trim();

  if (text === "") return null;
  // The column and the schema both cap at 300; truncating here keeps a long title from turning a
  // successful fetch into a validation failure.
  return text.slice(0, 300);
}
