import { dirname, join } from "node:path";

/**
 * Pyodide's files, served from this origin (Phase 5).
 *
 * From the installed package rather than a CDN — the runner's CSP allows nothing
 * else, and a learner's Python should not depend on a third party being up. The
 * directory is versioned in the URL (`/pyodide/<version>/…`), so each file can be
 * cached as immutable and an upgrade is a new URL rather than a stale cache.
 *
 * An allowlist, not a directory listing: these five are what `loadPyodide`
 * fetches for the standard library, and nothing else in the package is served.
 * Packages beyond the standard library would come from Pyodide's CDN, which the
 * Python runner's `connect-src 'self'` blocks — by design, and said in LESSON-SHAPE.md.
 */

const PACKAGE_DIR = dirname(Bun.resolveSync("pyodide/package.json", import.meta.dir));

export const PYODIDE_VERSION: string = (
  (await Bun.file(join(PACKAGE_DIR, "package.json")).json()) as { version: string }
).version;

export const PYODIDE_PREFIX = `/pyodide/${PYODIDE_VERSION}/`;

const FILES: Readonly<Record<string, string>> = {
  "pyodide.js": "text/javascript; charset=utf-8",
  "pyodide.asm.mjs": "text/javascript; charset=utf-8",
  "pyodide.asm.wasm": "application/wasm",
  "python_stdlib.zip": "application/zip",
  "pyodide-lock.json": "application/json",
};

/** The file a `/pyodide/<version>/<name>` path names, or null for anything else. */
export function pyodideFile(pathname: string): { path: string; contentType: string } | null {
  if (!pathname.startsWith(PYODIDE_PREFIX)) return null;
  const name = pathname.slice(PYODIDE_PREFIX.length);
  const contentType = FILES[name];
  return contentType === undefined ? null : { path: join(PACKAGE_DIR, name), contentType };
}
