import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { API, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import { LearnerMemory } from "./LearnerMemory.js";

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

/**
 * The "you own it" half of §7.6.
 *
 * The memory is sent with every lesson the agent writes, on every mission — so a
 * wrong entry is not a cosmetic problem, and the screen's job is to make removing
 * one obvious. These assert on wording where the wording is the decision.
 */

function memory(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "retains-by-building",
    kind: "learning_pattern",
    summary: "Retains by building, not by reading",
    writtenBy: "agent",
    confirmedAt: null,
    supersededBySlug: null,
    updatedAt: "2026-08-08T12:00:00.000Z",
    ...overrides,
  };
}

function memoryServer(
  memories: object[],
  hooks: { onConfirm?: () => void; onDelete?: () => void } = {},
) {
  server.use(
    http.get(`${API}/me/memory`, () => HttpResponse.json(memories)),
    http.post(`${API}/me/memory/:id/confirm`, () => {
      hooks.onConfirm?.();
      return HttpResponse.json(memory({ confirmedAt: "2026-08-08T13:00:00.000Z" }));
    }),
    http.delete(`${API}/me/memory/:id`, () => {
      hooks.onDelete?.();
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

describe("an empty memory", () => {
  it("explains why rather than looking broken", async () => {
    // §7.6: no onboarding questionnaire, so a new account genuinely has nothing
    // here. "Nothing yet, the agent writes this as it teaches you" is a different
    // message from a blank panel.
    memoryServer([]);

    renderWithProviders(<LearnerMemory />);

    expect(await screen.findByText(/The agent writes here as it teaches you/u)).toBeInTheDocument();
  });
});

describe("a memory the agent wrote", () => {
  it("shows the fact and what kind it is", async () => {
    memoryServer([memory()]);

    renderWithProviders(<LearnerMemory />);

    expect(await screen.findByText("Retains by building, not by reading")).toBeInTheDocument();
    // The column stores `learning_pattern`; the UI translates at render (§5.2).
    expect(screen.getByText("How you learn")).toBeInTheDocument();
  });

  it("says the memory is sent with every lesson, because that is why it matters", async () => {
    memoryServer([memory()]);

    renderWithProviders(<LearnerMemory />);

    expect(await screen.findByText(/sent with every lesson/u)).toBeInTheDocument();
  });

  it("offers to confirm one you have not reviewed", async () => {
    let confirmed = false;
    memoryServer([memory()], { onConfirm: () => (confirmed = true) });

    renderWithProviders(<LearnerMemory />);
    await userEvent.click(await screen.findByRole("button", { name: "That's right" }));

    await waitFor(() => {
      expect(confirmed).toBe(true);
    });
  });

  it("stops offering to confirm one you already did", async () => {
    // Silence is not agreement, so the mark means something — and offering it
    // twice would suggest the first press had not landed.
    memoryServer([memory({ confirmedAt: "2026-08-08T13:00:00.000Z" })]);

    renderWithProviders(<LearnerMemory />);

    expect(await screen.findByText("You agreed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "That's right" })).not.toBeInTheDocument();
  });

  it("lets you remove one that is wrong", async () => {
    let deleted = false;
    memoryServer([memory()], { onDelete: () => (deleted = true) });

    renderWithProviders(<LearnerMemory />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove this" }));

    await waitFor(() => {
      expect(deleted).toBe(true);
    });
  });
});

describe("a memory the agent replaced", () => {
  it("is still shown, with what replaced it", async () => {
    // §7.6: supersede, never mutate. That a stated preference changed is itself
    // the information — hiding the old entry would hide the change.
    memoryServer([
      memory({
        summary: "Likes analogies",
        supersededBySlug: "no-analogies",
      }),
    ]);

    renderWithProviders(<LearnerMemory />);

    expect(await screen.findByText("Likes analogies")).toBeInTheDocument();
    expect(screen.getByText(/replaced this with "no-analogies"/u)).toBeInTheDocument();
  });

  it("offers no buttons on it", async () => {
    // Confirming or deleting a belief the agent has already moved on from is a
    // decision about history rather than about what it currently thinks.
    memoryServer([memory({ supersededBySlug: "no-analogies" })]);

    renderWithProviders(<LearnerMemory />);
    await screen.findByText("Replaced");

    expect(screen.queryByRole("button", { name: "Remove this" })).not.toBeInTheDocument();
  });
});

describe("what it deliberately does not offer", () => {
  it("has no way to add one", async () => {
    // §7.6: what people say up front about how they learn is usually wrong. The
    // memory is what the agent noticed, and this screen is for correcting it.
    memoryServer([memory()]);

    renderWithProviders(<LearnerMemory />);
    await screen.findByText("Retains by building, not by reading");

    expect(screen.queryByRole("button", { name: /add|new/iu })).not.toBeInTheDocument();
  });
});
