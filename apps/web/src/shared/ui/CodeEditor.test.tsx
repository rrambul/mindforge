import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeEditor } from "./CodeEditor.js";

/**
 * The real CodeMirror, not a stand-in.
 *
 * Every feature test swaps the editor for a textarea, which is right for them and
 * would leave nothing proving the lazy import resolves and the editor mounts. This
 * is that proof, plus the one behaviour that is easy to break: a new `value` from
 * outside replaces the document (a reset to the starter) without the editor being
 * rebuilt.
 */

describe("CodeEditor", () => {
  it("mounts CodeMirror with the value and the accessible name", async () => {
    render(<CodeEditor value="const a = 1;" language="typescript" label="Your code" />);

    const surface = await screen.findByRole("textbox", { name: "Your code" });
    await waitFor(() => {
      expect(surface).toHaveTextContent("const a = 1;");
    });
  });

  it("replaces the document when the value changes from outside", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CodeEditor value="draft" language="javascript" label="Your code" onChange={onChange} />,
    );
    const surface = await screen.findByRole("textbox", { name: "Your code" });

    rerender(
      <CodeEditor value="starter" language="javascript" label="Your code" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(surface).toHaveTextContent("starter");
    });
    // The same element: replaced in place, so the undo history survives a reset.
    expect(screen.getByRole("textbox", { name: "Your code" })).toBe(surface);
  });

  it("does not let a read-only editor be typed into", async () => {
    render(<CodeEditor value="x" language="javascript" label="Solution" readOnly />);

    expect(await screen.findByRole("textbox", { name: "Solution" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
  });
});
