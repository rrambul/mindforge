import { describe, expect, test } from "bun:test";

/**
 * These assertions guard the isolation boundary described in TECH-DESIGN.md
 * §7.5. Lesson HTML is LLM-authored JavaScript; if these headers weaken, a
 * generated lesson gains the ability to reach the network or be framed by an
 * arbitrary origin. Failing this test means the sandbox is decorative.
 */

const PORT = 3987;

async function startServer(): Promise<{ url: string; stop: () => void }> {
  const proc = Bun.spawn(["bun", "src/index.ts"], {
    cwd: import.meta.dir + "/..",
    env: { ...Bun.env, PORT: String(PORT), APP_ORIGIN: "https://app.example" },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the listener rather than sleeping a fixed interval.
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      await fetch(`http://localhost:${PORT}/health`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("lessons server did not start");
      await Bun.sleep(50);
    }
  }

  return { url: `http://localhost:${PORT}`, stop: () => proc.kill() };
}

describe("lessons origin security headers", () => {
  test("a lesson response cannot reach the network and can only be framed by the app", async () => {
    const server = await startServer();
    try {
      const res = await fetch(`${server.url}/any-lesson.html`);
      const csp = res.headers.get("content-security-policy") ?? "";

      // The load-bearing directive: a lesson cannot phone home, so even a
      // malicious generation cannot exfiltrate what it can see.
      expect(csp).toContain("connect-src 'none'");

      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors https://app.example");
      expect(csp).toContain("form-action 'none'");
      expect(csp).toContain("base-uri 'none'");

      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    } finally {
      server.stop();
    }
  });

  test("health reports the running build", async () => {
    const server = await startServer();
    try {
      const res = await fetch(`${server.url}/health`);
      const body = (await res.json()) as Record<string, string>;
      expect(body["status"]).toBe("ok");
      expect(body["service"]).toBe("lessons");
      expect(body).toHaveProperty("commit");
    } finally {
      server.stop();
    }
  });
});
