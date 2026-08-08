import { useTranslation } from "react-i18next";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import { Callout, Stack, Text } from "../../../shared/ui/index.js";
import { useDismissNudge, useNudges } from "../api/use-notifications.js";
import { NudgeList } from "./NudgeList.js";

interface CurrentNudgesProps {
  readonly hrefFor?: (subjectType: string, subjectId: string) => string | undefined;
}

/**
 * The same nudges, in the page rather than behind the bar's marker.
 *
 * The marker is where you notice them; this is where you can look at them on purpose, next to the
 * settings that decide when they arrive. Both read the same cache entry, so dismissing one here
 * clears the marker in the same frame — which is the reason `NudgeList` does not fetch.
 */
export function CurrentNudges({ hrefFor }: CurrentNudgesProps) {
  const { t: common } = useTranslation("common");
  const nudges = useNudges();
  const dismiss = useDismissNudge();

  if (nudges.isPending) return <Text tone="muted">{common("state.loading")}</Text>;

  if (nudges.isError) {
    return (
      <Callout tone="danger" live>
        {nudges.error instanceof NetworkError
          ? common("state.offline")
          : nudges.error instanceof ApiError && nudges.error.problem
            ? nudges.error.problem.detail
            : common("error.unexpectedBody")}
      </Callout>
    );
  }

  return (
    <Stack gap="tight">
      <NudgeList
        nudges={nudges.data.notifications}
        onDismiss={(id) => dismiss.mutate({ id })}
        {...(dismiss.isPending && dismiss.variables ? { dismissingId: dismiss.variables.id } : {})}
        {...(hrefFor === undefined ? {} : { hrefFor })}
      />
    </Stack>
  );
}
