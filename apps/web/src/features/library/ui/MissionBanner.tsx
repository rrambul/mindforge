import { useState } from "react";

import { useMissionBanner } from "../api/use-library.js";
import "./mission-banner.css";

/**
 * The mission's banner at the top of its page (FR-T10).
 *
 * Artwork the curriculum step drew into `assets/banner.svg`, served by the
 * lessons origin like every other workspace file. An `<img>` and never a frame or
 * inline markup: as an image an SVG runs no script and loads nothing, which is
 * what lets untrusted artwork sit on the app's own page (non-negotiable 7).
 *
 * Decorative, so `alt=""`: the heading under it already says what the mission
 * is, and a screen reader announcing "AWS banner" first would be noise.
 *
 * Nothing renders while it loads, when there is no banner, or when the file
 * fails: a missing picture is not something the learner has to act on, so it
 * has no error state, and a placeholder would push the heading down and back.
 */
export function MissionBanner({ missionId }: { readonly missionId: string }) {
  const banner = useMissionBanner(missionId);
  const [failed, setFailed] = useState<string | null>(null);

  const url = banner.data?.url ?? null;
  // Keyed by URL, so a refetch's fresh grant gets a fresh try.
  if (url === null || failed === url) return null;

  return (
    <img
      className="mf-mission-banner"
      src={url}
      alt=""
      decoding="async"
      // The grant is in the URL; the app's own address has no business in the
      // lessons origin's logs either.
      referrerPolicy="no-referrer"
      onError={() => setFailed(url)}
    />
  );
}
