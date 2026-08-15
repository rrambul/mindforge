import type { ZodType } from "zod";

import { env } from "../lib/env.js";
import { ApiError, ContractError, isProblem, NetworkError, type Problem } from "./problem.js";
import { currentAccessToken } from "./supabase.js";

/**
 * The only place in the SPA that talks to the API.
 *
 * A component importing this directly is a bug (TECH-DESIGN.md §2.2 rule 2) — requests
 * belong in a feature's `api/` hooks, so that caching, optimistic writes, and error
 * mapping are decided once per endpoint rather than once per component.
 *
 * **Every response is parsed against a schema from `packages/core`.** This function
 * used to end in `return payload as T`, with each feature declaring its own copy of
 * the server's shape and a comment saying which one it mirrored. Nothing checked
 * the two agreed, so a field renamed on the server compiled cleanly on both sides
 * and arrived as `undefined` in a component. Now the shape is declared once, in
 * `schemas/wire.ts`, and a mismatch is one error naming the field.
 *
 * Unknown keys are stripped rather than rejected — zod's default and the right one
 * here: a server that adds a field must not break clients that predate it.
 */

interface RequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

async function request<T>(
  path: string,
  /**
   * Null is the deliberate escape hatch, and it has exactly one caller: the
   * offline queue replays mutations it stored before this code was loaded, so it
   * genuinely does not know what shape comes back and discards the body anyway.
   */
  schema: ZodType<T> | null,
  options: RequestOptions = {},
): Promise<T> {
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

  const payload = response.status === 204 ? undefined : await readBody(response);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      isProblem(payload) ? payload : null,
      isProblem(payload) ? payload.detail : `${response.status} from ${path}`,
    );
  }

  if (schema === null) return undefined as T;

  // A 204 reaches this as `undefined`, which is what `NoContent` accepts. Parsing
  // it rather than short-circuiting is deliberate: an endpoint that started
  // answering 204 where the client expects a body is a contract change, and
  // returning `undefined as T` for it is how that goes unnoticed until a render.
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ContractError(path, parsed.error.issues);

  return parsed.data;
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

/**
 * The schema comes second on every verb, before the body.
 *
 * Uniform on purpose: a signature where the schema moved depending on whether
 * there was a body would be the kind of thing that gets passed in the wrong
 * position, and `parse` on a `body` object fails in a way that reads like a server
 * bug.
 */
export const api = {
  get: <T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> =>
    request<T>(path, schema, signal ? { signal } : {}),
  post: <T>(path: string, schema: ZodType<T>, body?: unknown): Promise<T> =>
    request<T>(path, schema, body === undefined ? { method: "POST" } : { method: "POST", body }),
  // PUT for the endpoints that *replace* a set rather than merge into one — resource links, where
  // sending it twice has to leave the same state.
  put: <T>(path: string, schema: ZodType<T>, body: unknown): Promise<T> =>
    request<T>(path, schema, { method: "PUT", body }),
  patch: <T>(path: string, schema: ZodType<T>, body: unknown): Promise<T> =>
    request<T>(path, schema, { method: "PATCH", body }),
  delete: <T>(path: string, schema: ZodType<T>): Promise<T> =>
    request<T>(path, schema, { method: "DELETE" }),

  /**
   * A replay of a mutation queued while offline (§5).
   *
   * The one caller that cannot name a schema: `queue-context.tsx` stores a path
   * and a body in IndexedDB, possibly under a previous version of the app, and
   * throws the response away. Demanding a schema here would mean storing one, and
   * a schema serialised into IndexedDB last Tuesday is a contract nobody is
   * checking either.
   */
  replay: (path: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<void> =>
    request<void>(path, null, { method, body }),
};

export type { Problem };
