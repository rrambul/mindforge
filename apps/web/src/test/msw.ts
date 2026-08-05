import { HttpResponse } from "msw";
import { setupServer } from "msw/node";

/** Handlers are declared per test — there is no default happy path to drift from. */
export const server = setupServer();

export const API = "http://localhost:3000/v1";

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors: { field: string; code: string; message: string }[];
}

/**
 * A failure stated the way the API states it (§6.1), so a test cannot accidentally
 * assert against a shape the server never sends — including the content type, which is
 * what the client keys off to decide whether a body is a problem at all.
 */
export function problemResponse(
  status: number,
  slug: string,
  detail: string,
  errors: ProblemBody["errors"] = [],
): HttpResponse<ProblemBody> {
  return HttpResponse.json<ProblemBody>(
    {
      type: `https://mindforge.app/errors/${slug}`,
      title: "Problem",
      status,
      detail,
      instance: "/v1/missions",
      errors,
    },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}
