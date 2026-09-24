import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { curriculumKeys } from "../shared/api/query-keys.js";
import { curriculumLesson, curriculumModule, curriculumResponse } from "../test/fixtures.js";
import { API, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { EasierVersion } from "./EasierVersion.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

// A plain anchor: the router is the app's, and this test is about when the offer
// appears, not how a link is built.
vi.mock("../shared/ui/index.js", async (original) => {
  const actual = await original<Record<string, unknown>>();
  return {
    ...actual,
    RouterLink: ({ to, children }: { to: string; children: ReactNode }) => (
      <a href={to}>{children}</a>
    ),
  };
});

/**
 * When the reader offers an easier version (FR-D2).
 *
 * Only for a lesson that landed too hard, judged server-side — never for an
 * unjudged one, where an offer would be a guess — and only until a bridge exists.
 */

const MISSION = "11111111-1111-4111-8111-111111111111";
const LESSON = "88888888-8888-4888-8888-888888888888";
const BRIDGE = "99999999-9999-4999-8999-999999999999";

function curriculumWith(lesson: Parameters<typeof curriculumLesson>[0]) {
  server.use(
    http.get(`${API}/missions/${MISSION}/curriculum`, () =>
      HttpResponse.json(
        curriculumResponse({
          missionId: MISSION,
          modules: [
            curriculumModule({
              lessons: [
                curriculumLesson({ id: LESSON, status: "generated", ...lesson }),
                curriculumLesson({ id: crypto.randomUUID(), title: "Unrelated" }),
              ],
            }),
          ],
        }),
      ),
    ),
  );
}

function render() {
  return renderWithProviders(<EasierVersion missionId={MISSION} lessonId={LESSON} />);
}

describe("EasierVersion", () => {
  it("offers an easier version for a lesson that landed too hard", async () => {
    curriculumWith({
      completed: true,
      outcome: "lost",
      strain: { verdict: "too-hard", reasons: ["marked-lost"] },
    });
    render();

    expect(await screen.findByRole("button", { name: "Try an easier version" })).toBeEnabled();
  });

  it.each([
    [{ verdict: "in-zone" as const, reasons: ["passed" as const] }],
    [{ verdict: "too-easy" as const, reasons: ["first-try-no-hints-fast" as const] }],
    [{ verdict: null, unknown: "in-progress" as const }],
  ])("offers nothing for %j", async (strain) => {
    curriculumWith({ strain });
    const { queryClient } = render();

    // Absence only means something once the curriculum has actually arrived.
    await waitFor(() => {
      expect(queryClient.getQueryState(curriculumKeys.ofMission(MISSION))?.status).toBe("success");
    });
    expect(screen.queryByRole("button", { name: "Try an easier version" })).not.toBeInTheDocument();
  });

  it("links the bridge that exists instead of offering a second", async () => {
    curriculumWith({
      strain: { verdict: "too-hard", reasons: ["never-passed"] },
      bridge: { id: BRIDGE, title: "One step at a time" },
    });
    render();

    expect(await screen.findByRole("link", { name: "One step at a time" })).toHaveAttribute(
      "href",
      `/missions/${MISSION}/lessons/${BRIDGE}`,
    );
    expect(screen.queryByRole("button", { name: "Try an easier version" })).not.toBeInTheDocument();
  });
});
