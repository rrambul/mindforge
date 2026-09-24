import type { SceneElement } from "@mindforge/core";
import { lazy, Suspense } from "react";
import "./styles/whiteboard.css";

/**
 * What a feature can do with a drawn scene, without knowing which canvas drew it.
 *
 * Deliberately two operations: read the design, and photograph it. Everything else
 * the canvas library can do stays inside `whiteboard-impl.tsx`, so replacing the
 * library is a change to one file.
 */
export interface WhiteboardHandle {
  /** The live elements, as plain JSON — deleted ones left out. */
  readonly elements: () => SceneElement[];
  /** The design as a PNG data URL, on white, its longer side at most `maxSide` pixels. */
  readonly exportPng: (maxSide: number) => Promise<string>;
}

export interface WhiteboardProps {
  /** What the canvas opens with. Read once, at mount. */
  readonly initialElements: readonly SceneElement[];
  /**
   * The learner changed the drawing. Not called for the canvas settling on its
   * initial elements — only for a real edit — so a caller can start a clock on it.
   */
  readonly onChange?: (elements: SceneElement[]) => void;
  /** The handle, once the canvas is ready; null when it unmounts. */
  readonly onReady?: (handle: WhiteboardHandle | null) => void;
  /** The accessible name of the drawing surface. Already translated. */
  readonly label: string;
}

/**
 * Where the canvas loads its fonts from: this origin (`vite.config.ts` serves and
 * copies them). Without it the library falls back to esm.sh — a third party the
 * product never chose, on every whiteboard exercise.
 */
export const WHITEBOARD_ASSET_PATH = "/excalidraw/";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

/**
 * The drawing canvas, loaded only where something is drawn.
 *
 * `lazy` for the reason `CodeEditor` gives, more so: the canvas library is several
 * times the size of the rest of the app, and only a whiteboard exercise needs it.
 * The asset path is set in the loader, before the module that reads it exists.
 */
const Canvas = lazy(() => {
  window.EXCALIDRAW_ASSET_PATH = WHITEBOARD_ASSET_PATH;
  return import("./whiteboard-impl.js");
});

export function Whiteboard(props: WhiteboardProps) {
  return (
    <div className="mf-whiteboard" role="group" aria-label={props.label}>
      <Suspense fallback={<div className="mf-whiteboard__fallback" aria-hidden="true" />}>
        <Canvas {...props} />
      </Suspense>
    </div>
  );
}
