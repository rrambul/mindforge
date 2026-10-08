import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { API, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { MissionBanner } from "./MissionBanner.js";

/**
 * The banner (FR-T10). What matters is what it does when there is nothing to
 * show: no workspace, no file, or a file that fails. Each one is an empty space,
 * never a broken image or an error the learner cannot act on.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const MISSION = "11111111-1111-4111-8111-111111111111";
const URL_ = "http://localhost:3001/v/token.sig/assets/banner.svg";

function returns(url: string | null) {
  let calls = 0;
  server.use(
    http.get(`${API}/missions/${MISSION}/banner`, () => {
      calls += 1;
      return HttpResponse.json({
        url,
        expiresAt: url === null ? null : "2026-10-07T10:30:00.000Z",
      });
    }),
  );
  return () => calls;
}

describe("MissionBanner", () => {
  it("draws the signed banner as a decorative image", async () => {
    returns(URL_);
    const { container } = renderWithProviders(<MissionBanner missionId={MISSION} />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(URL_);
    // Decorative: the heading under it names the mission.
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders nothing when the mission has no banner", async () => {
    const calls = returns(null);
    const { container } = renderWithProviders(<MissionBanner missionId={MISSION} />);

    await waitFor(() => expect(calls()).toBe(1));
    expect(container.querySelector("img")).toBeNull();
  });

  it("removes itself when the file fails to load, rather than drawing a broken image", async () => {
    returns(URL_);
    const { container } = renderWithProviders(<MissionBanner missionId={MISSION} />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
  });
});
