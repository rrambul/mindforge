export const MEMORY_FILE_STORE = Symbol("MemoryFileStore");

/**
 * The API's one reason to touch Storage directly.
 *
 * Deliberately a single method. Everything else about a workspace is the worker's
 * — it holds the service-role key and materialises whole prefixes — and widening
 * this into a general Storage client would put a second implementation of §7.4's
 * sync one refactor away.
 *
 * It exists because deleting a memory has to delete the file. Files are canonical
 * (non-negotiable 5), so removing the row alone leaves the memory in Storage,
 * where the next run materialises it, the agent reads it, and the reindexer puts
 * the row back. A delete that undoes itself is worse than none, because the
 * learner believes it worked.
 */
export interface MemoryFileStore {
  remove(storagePath: string): Promise<void>;
}

export const MEMORY_STORAGE_CONFIG = Symbol("MemoryStorageConfig");

/**
 * The two values the file store needs, as a token of their own.
 *
 * Not the whole `Env`. This module is imported by `apps/worker`, whose `Env` is a
 * different shape with the same name — binding one app's env object to the
 * other's token would type-check through `useExisting` and hand back `undefined`
 * for any field only one of them declares. Two values that both apps genuinely
 * have is a contract; a shared `Env` symbol is a footgun waiting for the third
 * field somebody adds.
 *
 * The boot probe in `apps/worker/test/api-module-boot.test.ts` is what caught
 * this: the module stopped resolving there the moment the store reached for
 * `ENV`.
 */
export interface MemoryStorageConfig {
  readonly supabaseUrl: string;
  /** Bypasses RLS. The bucket has no policies, so nothing else can reach it. */
  readonly serviceRoleKey: string;
}
