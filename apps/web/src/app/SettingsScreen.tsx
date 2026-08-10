import { LearnerMemory } from "../features/memory/ui/LearnerMemory.js";
import { SettingsRoute } from "../features/settings/routes/SettingsRoute.js";

/**
 * Settings, with the learner memory the agent has accumulated shown beside the settings that
 * govern everything else.
 *
 * The composition is the reason this file exists: the preferences form belongs to
 * `features/settings` and the memory review to `features/memory`, and §2.2 rule 6 forbids either
 * importing the other. The screen that composes both hands one in as a render prop.
 */
export function SettingsScreen() {
  return <SettingsRoute renderMemory={() => <LearnerMemory />} />;
}
