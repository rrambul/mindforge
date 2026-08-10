import { useTranslation } from "react-i18next";

import "./lesson.css";

/**
 * The lesson itself, running in a box it cannot get out of (FR-T5, §7.5).
 *
 * **`sandbox` without `allow-same-origin`, and never with it.** Lesson HTML is
 * LLM-authored JavaScript — quizzes, simulators, whatever the agent decided the
 * material needed — and it is untrusted on principle rather than because any
 * particular lesson is suspect. `allow-scripts` together with `allow-same-origin`
 * lets the frame reach its own `frameElement` and remove the sandbox attribute,
 * which defeats the entire mechanism; the two together are the one combination
 * that must never appear. Adding it would make a broken lesson work, which is
 * exactly why it will be tempting one day.
 *
 * `allow-popups` is deliberate: a lesson linking out to real documentation is a
 * good lesson, and without this the link silently does nothing. The popup inherits
 * the sandbox, because `allow-popups-to-escape-sandbox` is absent.
 *
 * The origin is the other half, and it is not this component's to enforce: the URL
 * comes from the API and points at `apps/lessons`, a different host with
 * `connect-src 'none'` and a `frame-ancestors` allowing only this app. A same-origin
 * frame would reach the Supabase session whatever this attribute said.
 *
 * `key` is the URL, so React replaces the element rather than mutating `src` when a
 * new grant is minted — a mutated `src` on some browsers leaves the old document's
 * history entry behind and the back button starts stepping through lessons.
 */
export function LessonFrame({ url, title }: { readonly url: string; readonly title: string }) {
  const { t } = useTranslation("lesson");

  return (
    <iframe
      key={url}
      className="mf-lesson-frame"
      src={url}
      title={t("frame.title", { title })}
      sandbox="allow-scripts allow-popups"
      // The lesson may not reach for the camera, the clipboard or anything else the
      // parent could otherwise delegate. `sandbox` does not cover permissions.
      allow=""
      referrerPolicy="no-referrer"
      loading="eager"
    />
  );
}
