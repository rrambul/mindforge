import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ButtonLink,
  Card,
  CardSection,
  Figure,
  Heading,
  Row,
  Stack,
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
  /** What this resource is for (FR-R3), supplied by the screen that has the mission and skill names. */
  readonly links?: ReactNode;
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
  links,
}: ResourceCardProps) {
  const { t } = useTranslation("resources");
  const { t: g } = useTranslation("glossary");

  const over = resource.status === "finished" || resource.status === "abandoned";
  const percent = resource.fraction === null ? null : Math.round(resource.fraction * 100);
  const position = resource.progress && resource.progress.current > 0 ? resource.progress : null;

  return (
    // Labelled with the title, so a screen-reader user moving between cards by role hears which
    // resource each one is instead of "article" repeated down the list.
    <Card
      as="article"
      variant={resource.status === "active" ? "raised" : "muted"}
      label={resource.title}
    >
      {/* The two chips sit together above the title rather than at opposite ends of a `Spread`.
          Pushed apart they were two identically-styled badges with a gap between them, and nothing
          said which was the type and which was the state; adjacent they read as one line, "Book,
          Reading". The title then comes first in the reading order it deserves — it is what you are
          looking for when you scan the library, and it used to be the third thing on the card. */}
      <Stack gap="tight">
        <Row>
          {/* Both translated from stored enum values, never from display text (§5.2). */}
          <StatusChip>{g(`resourceType.${resource.type}`)}</StatusChip>
          <StatusChip {...(resource.status === "active" ? { accent: "ember" as const } : {})}>
            {g(`resourceStatus.${resource.status}`)}
          </StatusChip>
        </Row>

        <Heading level={2}>
          <span className="mf-resource-title">{resource.title}</span>
        </Heading>

        {resource.author ? <Text tone="muted">{resource.author}</Text> : null}
      </Stack>

      {/* One line for where you are, instead of the three stacked ones this was: a bar, then a
          percentage, then the position. They are all the same fact and belong together.

          A bar only when there is a real fraction. `fraction` is null rather than 0 when the total
          is unknown, and rendering an empty bar for it would claim you had made no progress. */}
      {percent === null && position === null ? null : (
        <div className="mf-resource-progress">
          {percent === null ? null : (
            <>
              <div
                className="mf-progress-track"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("progress.fraction", { percent })}
              >
                <div className="mf-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <Figure>{t("progress.fraction", { percent })}</Figure>
            </>
          )}

          {position === null ? null : (
            <Text as="span" tone="muted">
              {t("progress.atPosition", {
                unit: position.unit,
                current: position.current,
              })}
              {position.total === null ? "" : ` ${t("progress.of", { total: position.total })}`}
            </Text>
          )}
        </div>
      )}

      {/* Stated plainly, with no editorial. Abandoning is guilt-free (FR-R5), and the reason is
          data rather than a confession. */}
      {resource.status === "abandoned" ? (
        <Text tone="muted">
          {resource.abandonReason
            ? t("abandoned.reason", { reason: resource.abandonReason })
            : t("abandoned.noReason")}
        </Text>
      ) : null}

      {/* Each of these draws its own `CardSection` — a control and a fact stop looking alike. */}
      {over ? null : (
        <ProgressControl
          resource={resource}
          onMark={(current, total) => onMarkProgress(resource, current, total)}
          pending={pending}
        />
      )}

      {links}

      {/* The composer names itself ("Add a note"), so the rule is all the separation it needs. */}
      {note === undefined ? null : <CardSection>{note}</CardSection>}

      {/* Nothing to act on: something finished with no link has no actions, and an empty row under a
          rule reads as a control that failed to render. */}
      {!over || resource.url ? (
        <CardSection>
          <Row>
            {resource.url ? (
              <ButtonLink href={resource.url} target="_blank">
                {t("action.open")}
              </ButtonLink>
            ) : null}

            {/* The triage decision on something fresh out of the inbox, so it leads. */}
            {resource.status === "inbox" ? (
              <Button variant="primary" onClick={() => onQueue(resource)} disabled={pending}>
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
        </CardSection>
      ) : null}
    </Card>
  );
}
