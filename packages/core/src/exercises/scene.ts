import type { SceneElement } from "../schemas/exercise.js";

/**
 * A drawn design, as text a reviewer can read (FR-X8).
 *
 * The review is given the image *and* this. The image is the evidence — it is what
 * the learner drew — but a model reading boxes and arrows off pixels can misread
 * which arrow ends where, and a design review is mostly about exactly that. So the
 * structure the canvas already knows is stated too: every labelled shape, every
 * arrow between two of them, every free-standing note.
 *
 * Here rather than in the API because it is a function of the scene alone and the
 * SPA could want it (a "what the reviewer will see" preview); and in core because
 * it is the one description, used by whichever side needs it.
 */

const SHAPES = new Set(["rectangle", "ellipse", "diamond", "frame"]);
const CONNECTORS = new Set(["arrow", "line"]);

/** Characters of description before it is cut. A scene is not a document. */
export const SCENE_DESCRIPTION_MAX = 12_000;

export function describeScene(elements: readonly SceneElement[]): string {
  const live = elements.filter((element) => element.isDeleted !== true);
  const byId = new Map(live.map((element) => [element.id, element]));

  // A shape's label is a text element bound to it by `containerId`.
  const labelOf = new Map<string, string>();
  for (const element of live) {
    if (element.type === "text" && element.containerId && element.text?.trim()) {
      labelOf.set(element.containerId, clean(element.text));
    }
  }

  const name = (id: string | undefined): string | null => {
    if (id === undefined) return null;
    const element = byId.get(id);
    if (element === undefined) return null;
    return labelOf.get(id) ?? `an unlabelled ${element.type}`;
  };

  const shapes = live
    .filter((element) => SHAPES.has(element.type))
    .map((element) => `- ${element.type}: ${labelOf.get(element.id) ?? "(no label)"}`);

  const connections = live
    .filter((element) => CONNECTORS.has(element.type))
    .map((element) => {
      const from = name(element.startBinding?.elementId);
      const to = name(element.endBinding?.elementId);
      const label = labelOf.get(element.id);
      const edge =
        from !== null && to !== null
          ? `${from} ${element.type === "arrow" ? "→" : "—"} ${to}`
          : from !== null || to !== null
            ? `${from ?? "(nothing)"} ${element.type === "arrow" ? "→" : "—"} ${to ?? "(nothing)"}`
            : `a free-standing ${element.type}`;
      return `- ${edge}${label === undefined ? "" : ` (labelled "${label}")`}`;
    });

  const notes = live
    .filter((element) => element.type === "text" && !element.containerId && element.text?.trim())
    .map((element) => `- "${clean(element.text!)}"`);

  const drawings = live.filter((element) => element.type === "freedraw").length;

  const parts = [
    shapes.length === 0 ? "Shapes: none." : ["Shapes:", ...shapes].join("\n"),
    connections.length === 0 ? "Connections: none." : ["Connections:", ...connections].join("\n"),
    notes.length === 0 ? "Notes: none." : ["Notes:", ...notes].join("\n"),
    ...(drawings === 0
      ? []
      : [`Freehand strokes: ${drawings} (only visible in the image, not described here).`]),
  ];

  const text = parts.join("\n\n");
  return text.length <= SCENE_DESCRIPTION_MAX
    ? text
    : `${text.slice(0, SCENE_DESCRIPTION_MAX)}\n…(cut: the scene is larger than a review reads)`;
}

function clean(text: string): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, 200);
}
