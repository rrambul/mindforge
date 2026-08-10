/**
 * The lessons origin's environment, validated once at boot.
 *
 * Every one of these is required, and none has a development default that would
 * let the process start without it. A lessons service missing its Storage
 * credentials answers 404 to every lesson; one missing `LESSONS_TOKEN_SECRET`
 * answers 404 to every lesson *and* looks exactly the same in the logs. Both are
 * an operator problem, and an operator problem should stop the process with the
 * variable's name in the message rather than degrade into a product that appears
 * to have lost your content.
 *
 * `APP_ORIGIN` has a local default because it is a policy value rather than a
 * credential: getting it wrong breaks framing loudly and visibly, and requiring it
 * would make `bun src/index.ts` fail for someone poking at `/health`.
 */
export interface LessonsEnv {
  readonly port: number;
  /** The only origin allowed to frame a lesson (`frame-ancestors`). */
  readonly appOrigin: string;
  readonly supabaseUrl: string;
  /** Bypasses RLS. The workspace bucket has no policies, so nothing else can read it. */
  readonly serviceRoleKey: string;
  /** Shared with the API, which is the only thing that may mint a grant. */
  readonly tokenSecret: string;
  readonly version: string;
  readonly commit: string;
}

export function loadEnv(source: Record<string, string | undefined>): LessonsEnv {
  const missing: string[] = [];

  const required = (name: string): string => {
    const value = source[name];
    if (value === undefined || value.trim() === "") {
      missing.push(name);
      return "";
    }
    return value;
  };

  const env: LessonsEnv = {
    port: Number(source["PORT"] ?? 3001),
    appOrigin: source["APP_ORIGIN"] ?? "http://localhost:5173",
    supabaseUrl: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    tokenSecret: required("LESSONS_TOKEN_SECRET"),
    version: source["APP_VERSION"] ?? "0.0.0",
    commit: source["GIT_SHA"] ?? "dev",
  };

  // Names only — never the values. `SUPABASE_SERVICE_ROLE_KEY` is the one credential
  // in this process that can read every user's workspace.
  if (missing.length > 0) throw new Error(`Invalid environment. Check: ${missing.join(", ")}`);
  if (!Number.isInteger(env.port) || env.port <= 0) throw new Error("Invalid environment: PORT");

  return env;
}
