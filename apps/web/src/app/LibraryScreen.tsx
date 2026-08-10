import { useTranslation } from "react-i18next";

import { LibraryRoute } from "../features/library/routes/LibraryRoute.js";
import { RouterLink } from "../shared/ui/index.js";

/**
 * A mission's reference shelf and its written record (FR-T6).
 *
 * The only thing composed in is the way back, which is a route the feature has no
 * business naming — the same reason `MissionCard` takes its curriculum link as a
 * slot rather than importing the router.
 */
export function LibraryScreen({ missionId }: { readonly missionId: string }) {
  const { t } = useTranslation("library");

  return (
    <LibraryRoute
      missionId={missionId}
      back={<RouterLink to={`/missions/${missionId}`}>{t("back")}</RouterLink>}
    />
  );
}
