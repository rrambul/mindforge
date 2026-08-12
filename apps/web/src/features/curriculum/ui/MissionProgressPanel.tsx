import type { MissionProgress } from "@mindforge/core";
import { useTranslation } from "react-i18next";

import { ProgressBar, Stack, Text } from "../../../shared/ui/index.js";

/**
 * How far through the whole mission (FR-P3).
 *
 * The same rules as a module's, one level up. It is a **fraction of lessons**, not a
 * percentage and not a fraction of modules: modules are wildly different sizes here — a
 * curriculum's tracks run from three lessons to eight — so counting them would make
 * finishing a three-lesson module worth more than finishing an eight-lesson one.
 *
 * **It says what it could not count.** A mission whose later modules have no lessons
 * planned yet has a fraction over the planned part only, and rendering that as the
 * mission's progress without saying so would be a measurement of part of something
 * presented as a measurement of all of it. `missionProgress` returns the unplanned
 * module count for exactly this line.
 *
 * Nothing renders at all when nothing is planned, rather than an empty bar — the caller
 * is already showing the "no curriculum yet" state in that case.
 */
export function MissionProgressPanel({ progress }: { readonly progress: MissionProgress }) {
  const { t } = useTranslation("curriculum");

  const fraction = t("mission.progress", {
    completed: progress.completed,
    total: progress.total,
  });

  return (
    <Stack gap="tight">
      <Text tone="muted">{fraction}</Text>
      <ProgressBar
        completed={progress.completed}
        total={progress.total}
        label={t("mission.progressLabel")}
        valueText={fraction}
      />
      {progress.modulesNotPlanned > 0 ? (
        <Text tone="hint">{t("mission.notPlanned", { count: progress.modulesNotPlanned })}</Text>
      ) : null}
    </Stack>
  );
}
