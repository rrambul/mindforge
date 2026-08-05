import { env } from "../lib/env.js";
import { ApiError, isProblem, NetworkError, type Problem } from "./problem.js";
import { currentAccessToken } from "./supabase.js";

/**
 * The only place in the SPA that talks to the API.
 *
 * A component importing this directly is a bug (TECH-DESIGN.md §2.2 rule 2) — requests
 * belong in a feature's `api/` hooks, so that caching, optimistic writes, and error
 * mapping are decided once per endpoint rather than once per component.
 */

interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await currentAccessToken();

  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${env.VITE_API_ORIGIN}/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
      // The API authenticates by bearer token, not a cookie, so credentials are not
      // needed and including them would widen what CORS has to allow.
      credentials: "omit",
    });
  } catch (cause) {
    // Distinguished from an API error on purpose: a failed request has no translated
    // `detail`, and the offline queue (§5) will need to tell the two apart to know
    // what is worth retrying.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new NetworkError(cause);
  }

  if (response.status === 204) return undefined as T;

  const payload = await readBody(response);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      isProblem(payload) ? payload : null,
      isProblem(payload) ? payload.detail : `${response.status} from ${path}`,
    );
  }

  return payload as T;
}

/**
 * Tolerates a non-JSON error body. A proxy or a crashed process answers with HTML,
 * and `response.json()` would then throw a SyntaxError that buries the real status.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, body === undefined ? { method: "POST" } : { method: "POST", body }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};

export type { Problem };
