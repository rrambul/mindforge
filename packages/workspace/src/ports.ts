/**
 * What the workspace layer needs from the world, expressed as two interfaces it
 * does not implement.
 *
 * These exist so that materialise → run → sync can be written and tested as a
 * decision procedure rather than as a sequence of network calls. The
 * implementations — Supabase Storage and the filesystem — live in `apps/worker`,
 * which is also where they can fail in ways a unit test would not catch.
 *
 * Both are deliberately narrow. `ObjectStore` is not "Supabase Storage with the
 * names changed": it exposes `list` returning an ETag *and* a version because
 * §7.4's conflict check needs both, and it has no conditional write because
 * Storage does not have one either. An interface that promised
 * `putIfUnchanged()` would be a lie the caller would then build on.
 */

export interface StoredObject {
  /** Path relative to the prefix the listing was rooted at. */
  readonly path: string;
  readonly sizeBytes: number;
  /** `md5(content)` for a single-part upload, quoted as Storage returns it. */
  readonly etag: string | null;
  /**
   * Changes on every write, including one that leaves the bytes identical.
   *
   * Optional because obtaining it costs a request per object (`info()`) where
   * the ETag comes free with the listing. A caller that wants change detection
   * rather than content comparison pays for it.
   */
  readonly version?: string | null;
}

export interface ObjectStore {
  /**
   * Every object under `prefix`, with the metadata the conflict check needs.
   *
   * Called **before** downloading, because the download discards response
   * headers and the ETag can never come from it.
   */
  list(prefix: string): Promise<readonly StoredObject[]>;

  download(path: string): Promise<Uint8Array>;

  /**
   * Write, unconditionally.
   *
   * There is no `ifMatch` parameter because Supabase Storage ignores `If-Match`
   * — probed: a `PUT` with a deliberately wrong one returns 200 and overwrites.
   * Conflicts are therefore detected by re-listing and survived by retention
   * (§7.4), never prevented here.
   */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;

  remove(paths: readonly string[]): Promise<void>;
}

/** One file read off disk, ready to be hashed. */
export interface LocalFile {
  /** Relative to the workspace root. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface FileTree {
  /**
   * Every file under the root, excluding Mindforge's own scaffolding.
   *
   * The exclusion happens **here**, at the walk, rather than at the upload. A
   * file excluded only from the upload is still hashed, still enters the diff,
   * and diffs as `deleted` on the next run that writes it again.
   */
  walk(): Promise<readonly LocalFile[]>;

  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}
