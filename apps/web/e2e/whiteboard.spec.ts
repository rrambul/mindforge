import { expect, test, type Page } from "@playwright/test";

/**
 * A whiteboard exercise, in a real browser (FR-X7–X9, `PLAN-HANDS-ON.md` Phase 4).
 *
 * Three things no unit test can see. The canvas library is two megabytes of lazy
 * chunks and fonts, and "it loads" is only true in a browser that fetched them.
 * Its fonts are served from this app rather than a CDN, which is only true if no
 * request left localhost while it drew. And the rubric — the answer — is withheld
 * until the first review, which is only true if it is not on the page.
 *
 * **"Get feedback" is never pressed here.** The dev API holds a real key, and a
 * press is a live, billed model call (non-negotiable 8). `apps/api/test/reviews.test.ts`
 * covers the review with the model stubbed.
 */

const DEV = { email: "dev@mindforge.local", password: "mindforge-dev" };

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(DEV.email);
  await page.getByLabel("Password").fill(DEV.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("a design exercise draws on a self-hosted canvas, and keeps its rubric back", async ({
  page,
}) => {
  const external: string[] = [];
  const fonts: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/excalidraw/fonts/")) fonts.push(url.pathname);
    // Network requests only: a `blob:` URL is not one.
    if (!url.protocol.startsWith("http")) return;
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") external.push(url.href);
  });

  await signIn(page);
  await page.getByRole("link", { name: "Missions" }).click();
  await page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Distributed systems fundamentals" }) })
    .getByRole("link", { name: "Curriculum" })
    .click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "The network is not reliable" })
    .getByRole("link", { name: /^Read/u })
    .click();

  const panel = page.getByRole("region", { name: "Exercise: Charge exactly once" });
  await expect(panel).toBeVisible();

  // The canvas mounted: the lazy chunk, its styles and its fonts all arrived.
  const board = panel.getByRole("group", { name: "Whiteboard for Charge exactly once" });
  await expect(board.locator("canvas").first()).toBeVisible();

  // The answer is not on the page before a review — not hidden, absent.
  await expect(page.getByText(/idempotency key/u)).toHaveCount(0);

  // Nothing drawn, nothing to review.
  await expect(panel.getByRole("button", { name: "Draw your design first" })).toBeDisabled();

  // Draw one rectangle: the toolbar's rectangle tool, then a drag inside the visible canvas.
  await board.scrollIntoViewIfNeeded();
  await board.getByTitle(/Rectangle/u).click();
  const area = (await board.locator("canvas").last().boundingBox())!;
  const x = area.x + area.width * 0.3;
  const y = area.y + Math.min(area.height * 0.4, 160);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 70, { steps: 8 });
  await page.mouse.up();

  await expect(panel.getByRole("button", { name: "Get feedback" })).toBeEnabled();

  // And a text label, because text is what needs a font: a canvas of shapes alone
  // fetches none, and "no request left localhost" would then prove nothing.
  await board.getByTitle(/^Text/u).click();
  await page.mouse.click(x, y + 130);
  await page.keyboard.type("API gateway");
  await page.keyboard.press("Escape");

  // Let any font or chunk the drawing needed finish loading before counting hosts.
  await page.waitForLoadState("networkidle");
  // The fonts were really fetched — from this app, never from a CDN. The first
  // assertion is what stops the second from passing because nothing loaded at all.
  expect(fonts.length).toBeGreaterThan(0);
  expect(external).toEqual([]);
});
