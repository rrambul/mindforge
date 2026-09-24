import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import { Button, Callout, Row, Stack, Text } from "../../../shared/ui/index.js";
import { useRequestBridge } from "../api/use-teach.js";

export interface BridgeOfferProps {
  readonly missionId: string;
  readonly lessonId: string;
  /**
   * The bridge already written toward this lesson, rendered by the app layer as a
   * link. When present the offer is replaced by it: one bridge per lesson (FR-D2).
   */
  readonly existing?: ReactNode;
}

/**
 * "Try an easier version" (FR-D2), for a lesson that landed too hard.
 *
 * Offered, never automatic: the learner decides whether they want a smaller step
 * now, and the lesson they struggled with stays exactly as it is — nothing about it
 * is rewritten or hidden. The caller decides *whether* to render this (from the
 * verdict); this only asks.
 */
export function BridgeOffer({ missionId, lessonId, existing }: BridgeOfferProps) {
  const { t } = useTranslation("teach");
  const { t: common } = useTranslation("common");
  const bridge = useRequestBridge(missionId, lessonId);

  if (existing !== undefined) {
    return (
      <Text tone="muted">
        {`${t("bridge.existing")} `}
        {existing}
      </Text>
    );
  }

  // A plain status line, not a callout: the confirmation is the new state, stated
  // (`Callout` has no success tone, on purpose). The run itself appears in the
  // mission's run status, which this request invalidated.
  if (bridge.isSuccess) {
    return (
      <div role="status">
        <Text tone="muted">{t("bridge.queued")}</Text>
      </div>
    );
  }

  return (
    <Stack gap="tight">
      <Text tone="hint">{t("bridge.explain")}</Text>
      <Row>
        <Button
          onClick={() => {
            bridge.mutate();
          }}
          disabled={bridge.isPending}
        >
          {bridge.isPending ? t("bridge.pending") : t("bridge.action")}
        </Button>
      </Row>
      {bridge.isError ? (
        <Callout tone="danger" live>
          <Text>{describe(bridge.error, common)}</Text>
        </Callout>
      ) : null}
    </Stack>
  );
}

function describe(error: unknown, t: (key: string) => string): string {
  if (error instanceof NetworkError) return t("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return t("error.unexpectedBody");
}
