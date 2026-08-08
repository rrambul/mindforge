import { useTranslation } from "react-i18next";
import { Select } from "../../../shared/ui/index.js";
import { useThemeSetting } from "../api/use-theme-setting.js";

/**
 * The theme, applied on the pick rather than on a Save.
 *
 * The only setting on this screen whose whole effect is visible the instant you choose it, so a Save
 * button between the two would be a step that exists to be undone — and, worse, it would make this
 * control behave differently from the toggle in the bar. `useThemeSetting` is the same mechanism
 * behind both, which is what stops them disagreeing; see its doc for which store wins.
 *
 * The option words come from `common`, where the bar's toggle already reads them. Two copies of
 * "Dark" is two things that can drift.
 */
export function ThemeControl() {
  const { t } = useTranslation("settings");
  const { t: common } = useTranslation("common");
  const { theme, setTheme } = useThemeSetting();

  return (
    <Select
      label={t("theme.label")}
      hint={t("theme.hint")}
      value={theme}
      onChange={(event) => {
        setTheme(event.target.value === "dark" ? "dark" : "light");
      }}
      options={[
        { value: "light", label: common("theme.light") },
        { value: "dark", label: common("theme.dark") },
      ]}
    />
  );
}
