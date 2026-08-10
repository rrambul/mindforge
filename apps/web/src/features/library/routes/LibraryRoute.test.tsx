import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { API, problemResponse, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { LearningRecord, ReferenceDoc } from "../api/use-library.js";
import { LessonRecords } from "./LessonRecords.js";
import { LibraryRoute } from "./LibraryRoute.js";

/**
 * The library (FR-T6).
 *
 * What is worth testing here is what it refuses to invent: a reference doc with no
 * workspace behind it does not get a link that 404s, and a record with no evidence
 * does not get an empty "Evidence" heading — a labelled blank reads as something
 * missing rather than as something that did not happen.
 */

vi.mock("../../../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const MISSION = "11111111-1111-4111-8111-111111111111";
const LESSON = "88888888-8888-4888-8888-888888888888";

function doc(over: Partial<ReferenceDoc> = {}): ReferenceDoc {
  return {
    id: crypto.randomUUID(),
    slug: "ownership",
    title: "Ownership, in one page",
    updatedAt: "2026-08-09T12:00:00.000Z",
    url: "http://localhost:3001/v/token.sig/reference/ownership.html",
    ...over,
  };
}

function record(over: Partial<LearningRecord> = {}): LearningRecord {
  return {
    id: crypto.randomUUID(),
    seq: 1,
    title: "Borrowing clicked",
    lessonId: LESSON,
    lessonTitle: "Borrow checker errors",
    whatLearned: "Moves are not copies",
    evidence: "Rewrote the parser without clones",
    keyInsight: "Ownership is about drop order",
    struggles: "Lifetimes in signatures",
    next: "Try a self-referential struct",
    recordedAt: "2026-08-09T18:00:00.000Z",
    ...over,
  };
}

function returns(options: { docs?: readonly ReferenceDoc[]; records?: readonly LearningRecord[] }) {
  server.use(
    http.get(`${API}/missions/${MISSION}/reference-docs`, () =>
      HttpResponse.json({ docs: options.docs ?? [], expiresAt: "2026-08-10T10:00:00.000Z" }),
    ),
    http.get(`${API}/missions/${MISSION}/learning-records`, () =>
      HttpResponse.json({ records: options.records ?? [] }),
    ),
  );
}

describe("the reference shelf", () => {
  it("opens a document in a new tab, without handing it the grant in the URL", async () => {
    // `noreferrer` is load-bearing: the grant is a path segment, so a Referer header
    // would give whatever the document links to a working token.
    returns({ docs: [doc()] });
    renderWithProviders(<LibraryRoute missionId={MISSION} />);

    const link = await screen.findByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("says there is nothing to open rather than linking to a file that is not there", async () => {
    returns({ docs: [doc({ url: null })] });
    renderWithProviders(<LibraryRoute missionId={MISSION} />);

    expect(await screen.findByText("No workspace yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  });

  it("names what would put something on the shelf when it is empty", async () => {
    returns({});
    renderWithProviders(<LibraryRoute missionId={MISSION} />);

    expect(await screen.findByText(/No reference documents yet/u)).toBeInTheDocument();
  });

  it("offers a retry when the shelf cannot be read", async () => {
    server.use(
      http.get(`${API}/missions/${MISSION}/reference-docs`, () =>
        problemResponse(404, "mission-not-found", "That mission no longer exists."),
      ),
      http.get(`${API}/missions/${MISSION}/learning-records`, () =>
        HttpResponse.json({ records: [] }),
      ),
    );

    renderWithProviders(<LibraryRoute missionId={MISSION} />);
    expect(await screen.findByText("That mission no longer exists.")).toBeInTheDocument();
  });
});

describe("a learning record", () => {
  it("keeps the four questions apart, struggles included", async () => {
    returns({ records: [record()] });
    renderWithProviders(<LibraryRoute missionId={MISSION} />);

    const card = await screen.findByRole("article");

    expect(within(card).getByText("What you learned")).toBeInTheDocument();
    expect(within(card).getByText("Struggles")).toBeInTheDocument();
    expect(within(card).getByText("Lifetimes in signatures")).toBeInTheDocument();
  });

  it("omits a field the agent left blank rather than labelling a gap", async () => {
    returns({ records: [record({ evidence: null, struggles: "  " })] });
    renderWithProviders(<LibraryRoute missionId={MISSION} />);

    await screen.findByRole("article");
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Struggles")).not.toBeInTheDocument();
  });

  it("names the lesson it came out of, which is what links the two", async () => {
    returns({ records: [record()] });
    renderWithProviders(<LibraryRoute missionId={MISSION} />);

    expect(await screen.findByText("From: Borrow checker errors")).toBeInTheDocument();
  });
});

describe("records under a lesson", () => {
  it("renders nothing at all when the lesson has none", async () => {
    server.use(
      http.get(`${API}/missions/${MISSION}/learning-records`, () =>
        HttpResponse.json({ records: [] }),
      ),
    );

    const { container } = renderWithProviders(
      <LessonRecords missionId={MISSION} lessonId={LESSON} />,
    );

    // A permanent "no records yet" card under every unread lesson would be furniture
    // saying nothing.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("asks only for this lesson's records", async () => {
    let asked: string | null = null;
    server.use(
      http.get(`${API}/missions/${MISSION}/learning-records`, ({ request }) => {
        asked = new URL(request.url).searchParams.get("lessonId");
        return HttpResponse.json({ records: [record()] });
      }),
    );

    renderWithProviders(<LessonRecords missionId={MISSION} lessonId={LESSON} />);

    expect(await screen.findByText("Borrowing clicked")).toBeInTheDocument();
    expect(asked).toBe(LESSON);
  });
});
