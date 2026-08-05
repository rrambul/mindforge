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

  async read(url: string): Promise<UrlMetadata> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HtmlUrlMetadataReader.TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          // Some sites serve a very different page to something that looks like a crawler, and the
          // title we want is the one a person would see.
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mindforge/1.0 (+https://mindforge.app)",
        },
      });

      if (!response.ok) return EMPTY;

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
