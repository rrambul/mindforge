import { z } from "zod";

/**
 * The browser's environment, validated at module load.
 *
 * Only `VITE_*` reaches the bundle, which is the guardrail that keeps
 * `SUPABASE_SERVICE_ROLE_KEY` out of it — that key bypasses RLS entirely, so it must
 * never be reachable from a page. Validating here means a missing anon key is a
 * blank screen with a named cause rather than an "Invalid API key" from Supabase on
 * the first sign-in attempt.
 */
const EnvSchema = z.object({
  VITE_API_ORIGIN: z.url(),
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

function load(): Readonly<z.infer<typeof EnvSchema>> {
  const parsed = EnvSchema.safeParse(import.meta.env);
  if (parsed.success) return parsed.data;

  // Names only. The anon key is public by design, but echoing values into a console
  // is a habit that eventually prints one that isn't.
  const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid browser environment. Check .env.local for: ${missing}`);
}

export const env = load();
