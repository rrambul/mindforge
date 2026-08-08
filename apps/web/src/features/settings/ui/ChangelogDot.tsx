import { useTranslation } from "react-i18next";
import { VisuallyHidden } from "../../../shared/ui/index.js";
import { useChangelog } from "../api/use-changelog.js";
import { useProfile } from "../api/use-profile.js";
import { unseenCount } from "../model/version.js";
import "./settings.css";

/**
 * The unseen marker (§14.1) — "a single dot on the settings entry, dismissed by opening it".
 *
 * Meant to be rendered beside the Settings link in the bar, which is why it is exported rather than
 * drawn inside the settings screen: a dot on the screen that clears it the moment you arrive has
 * nobody to tell.
 *
 * **Nothing at all when there is nothing new.** Not a hidden element, not an empty span — the same
 * rule §5.3 sets for a null signal, because a marker that is present-but-blank teaches you to stop
 * looking at the place it appears. The dot is decorative and carries its meaning in text for anyone
 * who cannot see a coloured circle.
 *
 * Both queries are cached and shared: the changelog is a static asset with `staleTime: Infinity` and
 * the profile is the same entry the shell already holds, so rendering this in the bar costs no
 * request of its own.
 */
export function ChangelogDot() {
  const { t } = useTranslation("settings");
  const profile = useProfile();
  const changelog = useChangelog();

  if (!profile.isSuccess || !changelog.isSuccess) return null;

  const unseen = unseenCount(
    changelog.data.map((release) => release.version),
    profile.data.changelogSeenVersion,
  );
  if (unseen === 0) return null;

  return (
    <>
      <span className="mf-unseen-dot" aria-hidden="true" />
      <VisuallyHidden>{t("changelog.unseen", { count: unseen })}</VisuallyHidden>
    </>
  );
}
