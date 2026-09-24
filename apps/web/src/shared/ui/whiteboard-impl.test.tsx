import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WhiteboardHandle } from "./Whiteboard.js";
import WhiteboardImpl from "./whiteboard-impl.js";

/**
 * The adapter between Excalidraw and `Whiteboard`'s handle.
 *
 * The library itself is mocked: jsdom cannot draw, and what is worth testing here
 * is the translation — which changes count as the learner drawing, what a feature
 * is handed when it reads the scene, and how the image is exported.
 */

type ChangeHandler = (elements: readonly Record<string, unknown>[]) => void;

const captured: {
  props: Record<string, unknown> | null;
  api: { getSceneElements: () => unknown[] } | null;
} = { props: null, api: null };
const exportToBlob = vi.fn<(opts: Record<string, unknown>) => Promise<Blob>>();

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
  exportToBlob: (opts: Record<string, unknown>) => exportToBlob(opts),
}));
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

const scene = [
  { id: "a", type: "rectangle", version: 1 },
  { id: "gone", type: "ellipse", version: 3, isDeleted: true },
];

function mount(onChange = vi.fn(), onReady = vi.fn()) {
  const view = render(
    <WhiteboardImpl initialElements={[]} label="Board" onChange={onChange} onReady={onReady} />,
  );
  captured.api = { getSceneElements: () => scene };
  (captured.props!["excalidrawAPI"] as (api: unknown) => void)(captured.api);
  const handle = onReady.mock.calls.at(-1)?.[0] as WhiteboardHandle;
  const change = captured.props!["onChange"] as ChangeHandler;
  return { view, handle, change, onChange, onReady };
}

beforeEach(() => {
  captured.props = null;
  exportToBlob.mockReset();
});

describe("WhiteboardImpl", () => {
  it("opens on the initial elements, on white, with nothing to load, save or embed", () => {
    mount();

    expect(captured.props!["initialData"]).toMatchObject({
      elements: [],
      appState: { viewBackgroundColor: "#ffffff" },
    });
    expect(captured.props!["UIOptions"]).toMatchObject({
      canvasActions: { loadScene: false, saveAsImage: false, export: false },
      tools: { image: false },
    });
  });

  it("reports a change only when the elements moved, not when the canvas settles", () => {
    const { change, onChange } = mount();

    change([{ id: "a", type: "rectangle", version: 1 }]);
    expect(onChange).not.toHaveBeenCalled();

    // A pan or a selection re-renders with the same versions.
    change([{ id: "a", type: "rectangle", version: 1 }]);
    expect(onChange).not.toHaveBeenCalled();

    change([{ id: "a", type: "rectangle", version: 2 }]);
    expect(onChange).toHaveBeenCalledWith([{ id: "a", type: "rectangle", version: 2 }]);
  });

  it("hands a feature plain elements, with deleted ones left out", () => {
    const { handle } = mount();

    expect(handle.elements()).toEqual([{ id: "a", type: "rectangle", version: 1 }]);
  });

  it("exports the scene as a PNG data URL on white, at the size asked for", async () => {
    exportToBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    const { handle } = mount();

    const image = await handle.exportPng(1600);

    expect(image).toMatch(/^data:image\/png;base64,/u);
    expect(exportToBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        maxWidthOrHeight: 1600,
        mimeType: "image/png",
        appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
      }),
    );
  });

  it("gives the handle back as null when it unmounts", () => {
    const { view, onReady } = mount();

    view.unmount();

    expect(onReady).toHaveBeenLastCalledWith(null);
  });
});
