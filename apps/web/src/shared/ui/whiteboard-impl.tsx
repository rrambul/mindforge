import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { SceneElementSchema, type SceneElement } from "@mindforge/core";
import { useEffect, useRef } from "react";

import type { WhiteboardHandle, WhiteboardProps } from "./Whiteboard.js";

/**
 * The Excalidraw half of `Whiteboard`, split out so `lazy` can load it on demand.
 *
 * Excalidraw owns the scene; this translates it to and from plain JSON at the
 * boundary. Its `onChange` fires for everything — a pan, a selection, the first
 * render — so a change is reported only when the elements' versions moved, which
 * is what "the learner drew something" means.
 */

const WHITE = "#ffffff";

/**
 * `exportToBlob`'s own declaration lives in `@excalidraw/utils`, which the package
 * re-exports through a path eslint's type service cannot follow (tsc can). Named
 * here with exactly the options this file passes, so the call is checked rather
 * than waved through as `any`.
 */
type ExportToBlob = (options: {
  readonly elements: readonly unknown[];
  readonly appState: { readonly exportBackground: boolean; readonly viewBackgroundColor: string };
  readonly files: null;
  readonly maxWidthOrHeight: number;
  readonly mimeType: string;
}) => Promise<Blob>;
const exportPngBlob = exportToBlob as unknown as ExportToBlob;

/** Plain JSON elements, validated at the boundary, deleted ones dropped. */
function plain(elements: readonly unknown[]): SceneElement[] {
  const parsed = SceneElementSchema.array().safeParse(JSON.parse(JSON.stringify(elements)));
  return parsed.success ? parsed.data.filter((element) => element.isDeleted !== true) : [];
}

function versionOf(elements: readonly { version?: unknown }[]): number {
  return elements.reduce(
    (sum, element) => sum + (typeof element.version === "number" ? element.version : 0),
    0,
  );
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The exported image did not read as a data URL"));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Could not read the exported image"));
    };
    reader.readAsDataURL(blob);
  });
}

export default function WhiteboardImpl({ initialElements, onChange, onReady }: WhiteboardProps) {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const version = useRef<number | null>(null);
  const changed = useRef(onChange);
  const ready = useRef(onReady);

  useEffect(() => {
    changed.current = onChange;
    ready.current = onReady;
  }, [onChange, onReady]);

  useEffect(
    () => () => {
      ready.current?.(null);
    },
    [],
  );

  return (
    <Excalidraw
      // Excalidraw restores whatever it is given, so a scene saved by an older
      // version of the library still opens.
      initialData={{
        elements: initialElements as never,
        appState: { viewBackgroundColor: WHITE },
        scrollToContent: true,
      }}
      UIOptions={{
        // A design, not a file: nothing to open, save or export from here, and no
        // embedded images — a review reads shapes, arrows and words.
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          saveAsImage: false,
          export: false,
          toggleTheme: false,
        },
        tools: { image: false },
      }}
      excalidrawAPI={(instance) => {
        api.current = instance;
        const handle: WhiteboardHandle = {
          elements: () => plain(instance.getSceneElements()),
          exportPng: async (maxSide) =>
            asDataUrl(
              await exportPngBlob({
                elements: instance.getSceneElements(),
                appState: { exportBackground: true, viewBackgroundColor: WHITE },
                files: null,
                maxWidthOrHeight: maxSide,
                mimeType: "image/png",
              }),
            ),
        };
        ready.current?.(handle);
      }}
      onChange={(elements) => {
        const next = versionOf(elements);
        // The first call is the canvas settling on its initial elements.
        if (version.current === null) {
          version.current = next;
          return;
        }
        if (next === version.current) return;
        version.current = next;
        changed.current?.(plain(elements));
      }}
    />
  );
}
