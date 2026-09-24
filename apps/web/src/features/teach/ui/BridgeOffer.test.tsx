import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { agentRunResponse } from "../../../test/fixtures.js";
import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { BridgeOffer } from "./BridgeOffer.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

/**
 * "Try an easier version" (FR-D2).
 *
 * The things that matter: it asks rather than acts, it says the original stays as
 * it is, it goes to the lesson's own endpoint, and a refusal reads in the server's
 * words — out of budget and "already being taught" ask different things of you.
 */

const MISSION = "11111111-1111-4111-8111-111111111111";
const LESSON = "88888888-8888-4888-8888-888888888888";

describe("BridgeOffer", () => {
  it("explains what it will do, and posts to the lesson's bridge endpoint", async () => {
    const posted: string[] = [];
    server.use(
      http.get(`${API}/missions/${MISSION}/agent-runs`, () => HttpResponse.json([])),
      http.post(`${API}/lessons/${LESSON}/bridge`, ({ request }) => {
        posted.push(new URL(request.url).pathname);
        return HttpResponse.json(agentRunResponse({ missionId: MISSION, status: "queued" }), {
          status: 202,
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<BridgeOffer missionId={MISSION} lessonId={LESSON} />);

    expect(
      screen.getByText("Writes a smaller step toward this lesson. This one stays as it is."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try an easier version" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "An easier version is being written.",
    );
    expect(posted).toEqual([`/v1/lessons/${LESSON}/bridge`]);
  });

  it("says why in the server's words when it is refused", async () => {
    server.use(
      http.post(`${API}/lessons/${LESSON}/bridge`, () =>
        problemResponse(409, "run-already-active", "This mission is already being taught."),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<BridgeOffer missionId={MISSION} lessonId={LESSON} />);

    await user.click(screen.getByRole("button", { name: "Try an easier version" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This mission is already being taught.",
    );
    expect(screen.getByRole("button", { name: "Try an easier version" })).toBeEnabled();
  });

  it("disables itself while the request is in flight", async () => {
    server.use(http.post(`${API}/lessons/${LESSON}/bridge`, () => new Promise(() => {})));
    const user = userEvent.setup();
    renderWithProviders(<BridgeOffer missionId={MISSION} lessonId={LESSON} />);

    await user.click(screen.getByRole("button", { name: "Try an easier version" }));

    expect(await screen.findByRole("button", { name: "Queuing…" })).toBeDisabled();
  });

  it("shows the bridge that exists instead of offering another", () => {
    // One bridge per lesson: a second offer would queue a run the server refuses.
    renderWithProviders(
      <BridgeOffer
        missionId={MISSION}
        lessonId={LESSON}
        existing={<a href="/lessons/bridge">Commit index, one step at a time</a>}
      />,
    );

    expect(screen.getByText(/A smaller step toward this lesson:/u)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Commit index, one step at a time" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try an easier version" })).not.toBeInTheDocument();
  });
});
