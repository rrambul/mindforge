import { createClient } from "@supabase/supabase-js";

/**
 * Reading one object out of the workspace bucket.
 *
 * A port with one method, so the handler can be tested against a map of bytes
 * rather than a live Storage: every interesting case in `handler.ts` is about what
 * it refuses to fetch, and those tests must not need a network.
 *
 * Bytes only — no content type. Storage records one per object, but only when
 * whoever uploaded it said so, and an object restored by hand comes back
 * `application/octet-stream`. With `nosniff` set, a wrong type is a lesson the
 * browser will not render, so the handler derives it from the filename instead
 * (`contentTypeFor`).
 */
export interface WorkspaceObjects {
  /** Null when the object is not there — which the handler renders as 404. */
  read(path: string): Promise<ArrayBuffer | null>;
}

const BUCKET = "mindforge";

/**
 * Supabase Storage, with the service-role key.
 *
 * The key bypasses RLS, and that is the design: the bucket has no policies at all
 * (`20260808150000_workspace_bucket`), so this key is the only thing that can read
 * it. What keeps that safe is that this service never reads a path a client asked
 * for — it reads a path resolved under a prefix the API signed after an RLS-checked
 * ownership test (`resolveGrantedPath`).
 */
export class SupabaseWorkspaceObjects implements WorkspaceObjects {
  private readonly storage;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.storage = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
  }

  async read(path: string): Promise<ArrayBuffer | null> {
    const { data, error } = await this.storage.from(BUCKET).download(path);
    // Storage answers a missing object with an error rather than an empty body, and
    // the two are one answer here: 404, with nothing said about which it was.
    if (error !== null || data === null) return null;

    return data.arrayBuffer();
  }
}
