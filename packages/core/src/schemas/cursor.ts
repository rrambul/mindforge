/**
 * Keyset cursors for the lists that grow without bound (§6.1).
 *
 * `PaginationSchema` has declared `cursor` since M1 and nothing ever issued one:
 * `ListFocusSessions` took a hard `DEFAULT_LIMIT = 50` with a comment saying a
 * cursor "comes with the insights screens". Sessions accumulate for as long as
 * somebody uses the product, so the fifty-first was simply unreachable — history
 * that exists, is paid for, and cannot be read.
 *
 * **Keyset, not offset.** `OFFSET 200` re-scans two hundred rows and, worse,
 * silently skips or repeats rows when anything is inserted mid-scroll — which for
 * this product is every night, since the nightly rollup and any teach run write
 * while somebody may be paging. A cursor that names the last row seen is stable
 * under insertion by construction.
 *
 * **The tie-break is the id, and it is not optional.** Two sessions can share a
 * `started_at` to the microsecond — the offline queue replays a batch on
 * reconnect, and `seed:rich` writes several a day. Ordering on the timestamp
 * alone makes their relative order undefined, so a page boundary landing between
 * them drops one and repeats the other, both silently.
 */

/** One row's position in a `(startedAt desc, id desc)` ordering. */
export interface Keyset {
  readonly startedAt: Date;
  readonly id: string;
}

/**
 * Opaque to the client, and deliberately not encrypted.
 *
 * It encodes a timestamp and an id the caller already has in the page it was
 * given, so there is nothing to hide — and RLS decides what the next page may
 * contain regardless of what a tampered cursor asks for. What the encoding buys
 * is that the shape is free to change: base64url of `<iso>|<uuid>` today, and
 * anything at all tomorrow, because no client parses it.
 */
export function encodeCursor(keyset: Keyset): string {
  return base64UrlEncode(`${keyset.startedAt.toISOString()}|${keyset.id}`);
}

/**
 * Null for anything that is not a cursor this function wrote.
 *
 * Rejecting by returning null rather than throwing: a stale cursor from a
 * bookmarked URL or a previous release should serve the first page, not a 500.
 * The caller decides — `ListFocusSessions` treats null as "start from the top",
 * which is the only answer that leaves the list usable.
 */
export function decodeCursor(cursor: string | undefined): Keyset | null {
  if (cursor === undefined || cursor === "") return null;

  let decoded: string;
  try {
    decoded = base64UrlDecode(cursor);
  } catch {
    return null;
  }

  const separator = decoded.lastIndexOf("|");
  if (separator === -1) return null;

  const startedAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(startedAt.getTime()) || id === "") return null;

  return { startedAt, id };
}

/**
 * Base64url by hand, over four WHATWG globals named one by one.
 *
 * The same constraint `lessons/view-token.ts` documents at length: this package
 * compiles with `types: []` and `lib: ["ES2023"]` because it is bundled into the
 * browser as well as run in the API, so `Buffer` is not available and a `lib` wide
 * enough to type `btoa` would also be wide enough to type `document`. Declaring
 * the handful actually used is the smallest way to say "these, and none of the
 * rest of the platform".
 */
function base64UrlEncode(value: string): string {
  const bytes = new platform.TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return platform.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = platform.atob(padded);
  const bytes = Uint8Array.from(binary, (character: string) => character.charCodeAt(0));
  return new platform.TextDecoder().decode(bytes);
}

interface Platform {
  readonly TextEncoder: new () => { encode(input: string): Uint8Array };
  readonly TextDecoder: new () => { decode(input: Uint8Array): string };
  btoa(data: string): string;
  atob(data: string): string;
}

const platform = globalThis as unknown as Platform;
