/**
 * What a workspace file is served as.
 *
 * **Derived from the filename, not read back from Storage.** Supabase records a
 * mimetype per object, but only when whoever uploaded it said so — a file restored
 * by hand, or written through Studio, comes back `application/octet-stream`. The
 * lessons origin sets `X-Content-Type-Options: nosniff` (it has to; it serves
 * untrusted HTML), so an object whose recorded type is wrong is a lesson the browser
 * refuses to render and offers to download instead. The extension is the one fact
 * about the file that cannot drift.
 *
 * It lives in `packages/core` for the same reason the view grant does: `apps/worker`
 * sets this at upload and `apps/lessons` sets it at read, and two copies of the map
 * is two answers to what a `.html` file is. Core is the only package a Nest app on
 * Node and a Bun HTTP server can both import.
 */

/** Enough for what a teach workspace contains; anything else is served as bytes. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function contentTypeFor(path: string): string {
  // `lastIndexOf` rather than `split(".").pop()`, whose optional chain is a branch
  // that can never be taken — `split` always yields at least one element, and an
  // untestable branch in a package held to 100% is a line of noise forever.
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
