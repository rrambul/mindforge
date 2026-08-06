import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ButtonLink,
  Card,
  Row,
  Spread,
  StatusChip,
  Text,
} from "../../../shared/ui/index.js";
import type { Resource } from "../api/use-resources.js";
import { ProgressControl } from "./ProgressControl.js";
import "./resource-card.css";

interface ResourceCardProps {
  readonly resource: Resource;
  readonly onMarkProgress: (resource: Resource, current: number, total: number | null) => void;
  readonly onFinish: (resource: Resource) => void;
  readonly onAbandon: (resource: Resource) => void;
  readonly onQueue: (resource: Resource) => void;
  readonly pending: boolean;
  /**
   * A note composer for this card, supplied by the app layer (M1's "notes on anything").
   *
   * A slot rather than an import: §2.2 rule 6 stops this feature reaching into notes, so the screen
   * that composes both hands it in. Optional, so the card still renders in a test that does not care.
   */
  readonly note?: ReactNode;
}

/** Dumb by design: props in, markup out. */
export function ResourceCard({
  resource,
  onMarkProgress,
  onFinish,
  onAbandon,
  onQueue,
  pending,
  note,
}: ResourceCardProps) {
  const { t } = useTranslation("resources");
  const { t: g } = useTranslation("glossary");

  const over = resource.status === "finished" || resource.status === "abandoned";

  return (
    <Card as="article" variant={resource.status === "active" ? "raised" : "muted"}>
      <Spread>
        {/* Both translated from stored enum values, never from display text (§5.2). */}
        <StatusChip>{g(`resourceType.${resource.type}`)}</StatusChip>
        <StatusChip>{g(`resourceStatus.${resource.status}`)}</StatusChip>
      </Spread>

      <Text>
        <span className="mf-resource-title">{resource.title}</span>
      </Text>
      {resource.author ? <Text tone="muted">{resource.author}</Text> : null}

      {/* A bar only when there is a real fraction. `fraction` is null rather than 0 when the total
          is unknown, and rendering an empty bar for it would claim you had made no progress. */}
      {resource.fraction === null ? null : (
        <div
          className="mf-progress-track"
          role="progressbar"
          aria-valuenow={Math.round(resource.fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("progress.fraction", { percent: Math.round(resource.fraction * 100) })}
        >
          <div className="mf-progress-fill" style={{ width: `${resource.fraction * 100}%` }} />
        </div>
      )}

      {resource.progress && resource.progress.current > 0 ? (
        <Text tone="muted">
          {t("progress.atPosition", {
            unit: resource.progress.unit,
            current: resource.progress.current,
          })}
          {resource.progress.total === null
            ? ""
            : ` ${t("progress.of", { total: resource.progress.total })}`}
        </Text>
      ) : null}

      {/* Stated plainly, with no editorial. Abandoning is guilt-free (FR-R5), and the reason is
          data rather than a confession. */}
      {resource.status === "abandoned" ? (
        <Text tone="muted">
          {resource.abandonReason
            ? t("abandoned.reason", { reason: resource.abandonReason })
            : t("abandoned.noReason")}
        </Text>
      ) : null}

      {over ? null : (
        <ProgressControl
          resource={resource}
          onMark={(current, total) => onMarkProgress(resource, current, total)}
          pending={pending}
        />
      )}

      {note}

      <Row>
        {resource.url ? (
          <ButtonLink href={resource.url} target="_blank" variant="quiet">
            {t("action.open")}
          </ButtonLink>
        ) : null}

        {resource.status === "inbox" ? (
          <Button onClick={() => onQueue(resource)} disabled={pending}>
            {t("action.queue")}
          </Button>
        ) : null}

        {over ? null : (
          <>
            <Button onClick={() => onFinish(resource)} disabled={pending}>
              {t("action.finish")}
            </Button>
            <Button variant="quiet" onClick={() => onAbandon(resource)} disabled={pending}>
              {t("action.abandon")}
            </Button>
          </>
        )}
      </Row>
    </Card>
  );
}
