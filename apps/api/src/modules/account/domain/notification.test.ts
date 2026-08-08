import { describe, expect, it } from "vitest";
import { Notification, type NotificationSnapshot } from "./notification.js";

const RAISED = new Date("2026-08-03T18:00:00Z");
const TAPPED = new Date("2026-08-05T09:00:00Z");
const REPLAYED = new Date("2026-08-05T11:30:00Z");

function aNotification(overrides: Partial<NotificationSnapshot> = {}): Notification {
  return Notification.fromSnapshot({
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    userId: "11111111-1111-4111-8111-111111111111",
    kind: "stall",
    payload: { missionTopic: "Rust ownership", days: 14 },
    subjectType: "mission",
    subjectId: "33333333-3333-4333-8333-333333333333",
    createdAt: RAISED,
    dismissedAt: null,
    ...overrides,
  });
}

describe("Notification", () => {
  it("round-trips through a snapshot", () => {
    const snapshot = aNotification().toSnapshot();

    expect(snapshot.kind).toBe("stall");
    expect(snapshot.payload).toEqual({ missionTopic: "Rust ownership", days: 14 });
    expect(snapshot.subjectType).toBe("mission");
    expect(snapshot.createdAt).toEqual(RAISED);
    expect(snapshot.dismissedAt).toBeNull();
  });

  it("stamps the moment it was dismissed", () => {
    const notification = aNotification();
    notification.dismiss(TAPPED);

    expect(notification.dismissedAt).toEqual(TAPPED);
  });

  it("keeps the first timestamp when the tap is replayed", () => {
    // Dismissing travels through the offline queue, so it arrives twice as a matter of course.
    // Moving the timestamp would record when the network came back, not when you stopped caring.
    const notification = aNotification();
    notification.dismiss(TAPPED);
    notification.dismiss(REPLAYED);

    expect(notification.dismissedAt).toEqual(TAPPED);
  });

  it("carries no subject for a nudge about the week rather than about a thing", () => {
    const weekly = aNotification({ kind: "weekly_review", subjectType: null, subjectId: null });

    expect(weekly.subjectType).toBeNull();
    expect(weekly.subjectId).toBeNull();
  });
});
