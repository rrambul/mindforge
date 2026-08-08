import { CurrentNudges } from "../features/notifications/ui/CurrentNudges.js";
import { SettingsRoute } from "../features/settings/routes/SettingsRoute.js";

/**
 * Settings, with the nudges you currently have shown beside the settings that govern them.
 *
 * The composition is the point and it is the reason this file exists: the preferences form belongs to
 * `features/settings` and the nudges to `features/notifications`, and §2.2 rule 6 forbids either
 * importing the other. The screen that composes both hands one in as a render prop — the same shape
 * `SkillsScreen` uses for the note composer.
 *
 * No `hrefFor` yet: a nudge's subject is a mission, and `/missions` is a list rather than a page per
 * mission, so every link would land on the same screen. `NudgeList` renders a row with no link when
 * the resolver returns nothing, which is honest — wire it here the day a mission has a URL.
 */
export function SettingsScreen() {
  return <SettingsRoute renderNudges={() => <CurrentNudges />} />;
}
