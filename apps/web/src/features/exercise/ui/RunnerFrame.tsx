import type { RefObject } from "react";

import "./exercise.css";

/**
 * The test runner's frame. Invisible, and exactly as boxed in as a lesson.
 *
 * **`sandbox="allow-scripts"` and nothing else.** The runner executes tests the
 * agent wrote, against code the learner typed; it is untrusted for the same reason
 * lesson HTML is (§7.5). `allow-same-origin` beside `allow-scripts` would let it
 * delete its own sandbox, and unlike the lesson frame it has no reason to open
 * popups either — so it gets the one permission running code needs.
 *
 * Hidden by size rather than `display: none`, so no browser is tempted to skip
 * loading it: the frame has no content to show, only a worker to host.
 */
export function RunnerFrame({
  src,
  title,
  frameRef,
}: {
  readonly src: string;
  /** Distinct per runner, so a lesson with both says which frame is which. */
  readonly title: string;
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
}) {
  return (
    <iframe
      ref={frameRef}
      className="mf-exercise-runner"
      src={src}
      title={title}
      sandbox="allow-scripts"
      allow=""
      referrerPolicy="no-referrer"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
