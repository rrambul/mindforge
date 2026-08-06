import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Action } from "../lib/action-registry.js";
import { CommandSurface } from "./CommandSurface.js";

const LABELS = {
  title: "Commands",
  search: "What do you want to do?",
  empty: "Nothing matches that.",
};

function surface(actions: Action[], onClose = vi.fn()) {
  const result = render(
    <CommandSurface actions={actions} isOpen onClose={onClose} labels={LABELS} />,
  );
  return { ...result, onClose };
}

function action(label: string, run: () => void, extra: Partial<Action> = {}): Action {
  return {
    id: label.toLowerCase().replace(/\s+/g, "-"),
    label,
    group: "Capture",
    run,
    ...extra,
  };
}

describe("opening and closing", () => {
  it("renders nothing when closed", () => {
    render(<CommandSurface actions={[]} isOpen={false} onClose={vi.fn()} labels={LABELS} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("focuses the input so typing works immediately", () => {
    // A palette you have to click into costs more than the button it replaced.
    surface([action("Start focus", vi.fn())]);
    expect(screen.getByLabelText(LABELS.search)).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const { onClose } = surface([action("Start focus", vi.fn())]);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on a click outside", async () => {
    const { onClose } = surface([action("Start focus", vi.fn())]);
    await userEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on a click inside", async () => {
    const { onClose } = surface([action("Start focus", vi.fn())]);
    await userEvent.click(screen.getByLabelText(LABELS.search));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("running an action", () => {
  it("runs the first match on Enter", async () => {
    // The whole point: one keystroke, a few characters, Enter. If the first result were unpredictable
    // this would be unusable.
    const start = vi.fn();
    surface([action("Start focus", start), action("Notes", vi.fn())]);

    await userEvent.type(screen.getByLabelText(LABELS.search), "start{Enter}");
    expect(start).toHaveBeenCalled();
  });

  it("closes before running, so the surface is gone when the action takes effect", async () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push("close"));
    render(
      <CommandSurface
        actions={[action("Start focus", () => order.push("run"))]}
        isOpen
        onClose={onClose}
        labels={LABELS}
      />,
    );

    await userEvent.keyboard("{Enter}");
    expect(order).toEqual(["close", "run"]);
  });

  it("runs on a click", async () => {
    const start = vi.fn();
    surface([action("Start focus", start)]);

    await userEvent.click(screen.getByRole("option", { name: "Start focus" }));
    expect(start).toHaveBeenCalled();
  });

  it("moves the selection with the arrow keys", async () => {
    const stop = vi.fn();
    surface([action("Start focus", vi.fn()), action("Stop focus", stop)]);

    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(stop).toHaveBeenCalled();
  });

  it("wraps at the end of the list", async () => {
    // A list this short is faster to cycle than to reverse direction in.
    const start = vi.fn();
    surface([action("Start focus", start), action("Stop focus", vi.fn())]);

    await userEvent.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(start).toHaveBeenCalled();
  });
});

describe("an unavailable action", () => {
  const unavailable = [
    action("Stop focus", vi.fn(), { unavailableReason: "Nothing running" }),
    action("Start focus", vi.fn()),
  ];

  it("is shown with its reason rather than hidden", () => {
    // An action that vanishes teaches that the palette is unreliable, and the user retypes it looking
    // for a typo.
    surface(unavailable);

    const option = screen.getByRole("option", { name: /Stop focus/ });
    expect(option).toBeDisabled();
    expect(within(option).getByText("Nothing running")).toBeVisible();
  });

  it("does nothing on Enter, and does not close", async () => {
    // Closing would look like it ran, which on "Stop focus" with nothing running is a confusing lie.
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandSurface
        actions={[action("Stop focus", run, { unavailableReason: "Nothing running" })]}
        isOpen
        onClose={onClose}
        labels={LABELS}
      />,
    );

    await userEvent.keyboard("{Enter}");
    expect(run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the list", () => {
  it("filters as you type", async () => {
    surface([action("Start focus", vi.fn()), action("Notes", vi.fn(), { group: "Go to" })]);

    await userEvent.type(screen.getByLabelText(LABELS.search), "notes");
    expect(screen.getByRole("option", { name: "Notes" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Start focus" })).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    surface([action("Start focus", vi.fn())]);

    await userEvent.type(screen.getByLabelText(LABELS.search), "kubernetes");
    expect(screen.getByText(LABELS.empty)).toBeVisible();
  });

  it("groups by heading, once per group", () => {
    surface([
      action("Start focus", vi.fn()),
      action("Stop focus", vi.fn()),
      action("Notes", vi.fn(), { group: "Go to" }),
    ]);

    expect(screen.getAllByText("Capture")).toHaveLength(1);
    expect(screen.getAllByText("Go to")).toHaveLength(1);
  });

  it("marks the selected option for assistive technology", async () => {
    surface([action("Start focus", vi.fn()), action("Stop focus", vi.fn())]);

    expect(screen.getByRole("option", { name: "Start focus" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Stop focus" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the selection in range as the list shrinks", async () => {
    // Typing one more character must not throw away the selection just because the list got shorter.
    const stop = vi.fn();
    surface([action("Start focus", vi.fn()), action("Stop focus", stop)]);

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.type(screen.getByLabelText(LABELS.search), "stop");
    await userEvent.keyboard("{Enter}");

    expect(stop).toHaveBeenCalled();
  });
});
