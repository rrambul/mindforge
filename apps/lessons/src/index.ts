/**
 * Lessons origin — serves agent-generated workspace files.
 *
 * Runs on Bun: this service is pure I/O (fetch bytes from Storage, stream them
 * out) with no Prisma and no Nest, which is exactly where Bun's advantage is
 * real. It is also fully isolated, so a problem here cannot reach the API.
 *
 * SECURITY — the whole point of this service (TECH-DESIGN.md §7.5):
 * Lesson HTML is LLM-authored JavaScript. It is untrusted. This process exists
 * so that content runs on an origin that has NO access to the app's cookies,
 * localStorage, or Supabase session. Do not merge it into the API to save a
 * deployment, and do not relax the headers below to make something work.
 */

const PORT = Number(Bun.env.PORT ?? 3001);
const APP_ORIGIN = Bun.env.APP_ORIGIN ?? "http://localhost:5173";
const API_ORIGIN = Bun.env.API_ORIGIN ?? "http://localhost:3000";

/**
 * `connect-src 'none'` is the load-bearing directive: a lesson cannot phone
 * home, so even a malicious or confused generation cannot exfiltrate anything
 * it can see. `frame-ancestors` restricts who may embed us to the app itself.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'self'",
  "style-src 'unsafe-inline' 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  `frame-ancestors ${APP_ORIGIN}`,
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-site",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "lessons",
        version: Bun.env.APP_VERSION ?? "0.0.0",
        commit: Bun.env.GIT_SHA ?? "dev",
      });
    }

    // Everything else requires a signed token minted by the API after an
    // RLS-checked ownership test. This service never trusts a client path.
    return new Response("Not implemented", {
      status: 501,
      headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain" },
    });
  },
});

console.log(
  JSON.stringify({
    msg: "lessons origin listening",
    port: server.port,
    appOrigin: APP_ORIGIN,
    apiOrigin: API_ORIGIN,
  }),
);
