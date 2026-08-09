import { Inject, Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  MEMORY_STORAGE_CONFIG,
  type MemoryFileStore,
  type MemoryStorageConfig,
} from "../application/memory-file.port.js";

const BUCKET = "mindforge";

/**
 * Removing one memory file.
 *
 * The API's only direct use of Storage, and it uses the **service-role** key —
 * the bucket has no policies, so nothing else can reach it (see the
 * `20260808150000_workspace_bucket` migration).
 *
 * The path is never taken from the client. It comes from the row the caller just
 * deleted under RLS, which is what makes "delete my memory" unable to become
 * "delete somebody else's file": the ownership check happened in Postgres, and
 * this only executes on a path that check returned.
 */
@Injectable()
export class SupabaseMemoryFileStore implements MemoryFileStore {
  private readonly storage: SupabaseClient["storage"];

  constructor(@Inject(MEMORY_STORAGE_CONFIG) config: MemoryStorageConfig) {
    this.storage = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
  }

  async remove(storagePath: string): Promise<void> {
    const { error } = await this.storage.from(BUCKET).remove([storagePath]);
    if (error) throw error;
  }
}
