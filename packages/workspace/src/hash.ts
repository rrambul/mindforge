import { createHash } from "node:crypto";

/**
 * Content hashing for the sync ledger.
 *
 * Two algorithms, because they answer two different questions.
 *
 * **sha256 is ours.** It is what `workspace_files.content_hash` stores and what
 * the diff compares, and it is chosen rather than inherited.
 *
 * **md5 is Supabase Storage's.** An ETag on a single-part upload *is*
 * `md5(content)` — probed against `storage-api v1.60.4`, not assumed — so
 * computing one locally is how a file on disk can be compared with an object in
 * Storage without downloading it. That is the only reason md5 appears in a
 * codebase written in 2026; it is a compatibility shim with somebody else's
 * cache header, and it is never used as a checksum on its own.
 */

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The ETag Storage would report for these bytes, quotes and all.
 *
 * Storage returns the value quoted (`"5d41402a…"`), and comparing a quoted value
 * with an unquoted one is a mismatch on every file — which reads as "somebody
 * else wrote this" and turns every sync into a conflict.
 */
export function storageEtag(bytes: Uint8Array | string): string {
  return `"${createHash("md5").update(bytes).digest("hex")}"`;
}

/** Strip Storage's quoting so two ETags from different endpoints compare equal. */
export function normalizeEtag(etag: string | null | undefined): string | null {
  if (etag === null || etag === undefined) return null;
  const trimmed = etag.trim().replace(/^W\//u, "").replace(/^"|"$/gu, "");
  return trimmed === "" ? null : trimmed;
}

/** True when two ETags refer to the same content, ignoring quoting and weakness. */
export function etagsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeEtag(a);
  const right = normalizeEtag(b);
  return left !== null && right !== null && left === right;
}
