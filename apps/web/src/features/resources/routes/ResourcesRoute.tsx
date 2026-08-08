import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import {
  Button,
  Callout,
  Heading,
  Row,
  Select,
  Spread,
  Stack,
  Text,
} from "../../../shared/ui/index.js";
import {
  captureBody,
  useAbandonResource,
  useAddResource,
  useCaptureResource,
  useEditResource,
  useFinishResource,
  useMarkProgress,
  useResources,
  type Resource,
} from "../api/use-resources.js";
import { AddResourceForm } from "../ui/AddResourceForm.js";
import { CaptureUrl } from "../ui/CaptureUrl.js";
import { ResourceCard } from "../ui/ResourceCard.js";

/** The filters worth offering. `reference` is left out until docs have somewhere to be used from. */
const FILTERS = ["all", "inbox", "active", "queued", "finished", "abandoned"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * The library (FR-R1..R6).
 *
 * Capture is at the top and everything else is below it, which is the honest ordering: you paste
 * links constantly and triage occasionally. The list is already sorted by the server so that what you
 * are reading is first and what is over is last.
 */
export interface ResourcesRouteProps {
  /**
   * Builds the note composer for one card, supplied by the app layer.
   *
   * A render prop because the composer needs the notes feature and this one may not import it (§2.2
   * rule 6). Optional, so the route renders without it.
   */
  readonly renderNote?: (subjectId: string) => ReactNode;
  /**
   * Builds the link editor for one resource (FR-R3).
   *
   * A render prop for the same reason as the note: the pickers need mission and skill names, and this
   * feature may not import those features (§2.2 rule 6).
   */
  readonly renderLinks?: (resource: Resource) => ReactNode;
}

/**
 * The id a mutation is *currently* working on, or undefined.
 *
 * `mutation.variables` alone is what this read before, and TanStack v5 keeps `variables` after a
 * mutation settles — so closing one goal pinned `pendingId` to it for the rest of the session, and no
 * later write on any row ever showed as pending again. `MissionsRoute` had the correct shape all
 * along (`isPending && variables?.id === x`); this is that, factored out.
 */
function pendingOf(
  mutation: {
    readonly isPending: boolean;
    readonly variables?: Record<string, unknown> | undefined;
  },
  field: string,
): string | undefined {
  if (!mutation.isPending) return undefined;
  const value = mutation.variables?.[field];
  return typeof value === "string" ? value : undefined;
}

export function ResourcesRoute({ renderNote, renderLinks }: ResourcesRouteProps) {
  const { t } = useTranslation("resources");
  const { t: g } = useTranslation("glossary");
  const { t: common } = useTranslation("common");

  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);

  const resources = useResources(filter === "all" ? {} : { status: filter });
  const capture = useCaptureResource();
  const add = useAddResource();
  const progress = useMarkProgress();
  const edit = useEditResource();
  const finish = useFinishResource();
  const abandon = useAbandonResource();

  // Which card is mid-write, so only its buttons go quiet rather than the whole list.
  const pendingId =
    pendingOf(progress, "id") ??
    pendingOf(edit, "id") ??
    pendingOf(finish, "id") ??
    pendingOf(abandon, "id");

  // Capture failures that were *queued* are deliberately absent here: the shell already reports the
  // pending count, and a red alert next to a box that accepted your link would contradict itself.
  const refused = [progress.error, edit.error, finish.error, abandon.error, add.error].find(
    (error) => error !== null && !(error instanceof NetworkError),
  );

  return (
    <Stack>
      <Spread>
        <Heading level={1}>{t("heading")}</Heading>
      </Spread>

      <CaptureUrl
        onCapture={(url) => capture.mutate(captureBody({ url }))}
        pending={capture.isPending}
      />

      <Row>
        <Button variant="quiet" onClick={() => setAdding(!adding)}>
          {adding ? t("add.close") : t("add.toggle")}
        </Button>
      </Row>

      {adding ? (
        <AddResourceForm
          onAdd={(input) =>
            add.mutate(
              {
                id: crypto.randomUUID(),
                type: input.type,
                title: input.title,
                ...(input.author === null ? {} : { author: input.author }),
                status: "queued",
              },
              // Closed only on success, so a rejected add leaves the typing in place to correct.
              { onSuccess: () => setAdding(false) },
            )
          }
          pending={add.isPending}
        />
      ) : null}

      <Select
        label={t("filter.label")}
        value={filter}
        onChange={(event) => setFilter(event.target.value as Filter)}
        options={FILTERS.map((candidate) => ({
          value: candidate,
          // Every option but "all" is a status, so its label comes from the glossary rather than from
          // a second copy in this namespace — §5.2 translates the domain vocabulary once, and two
          // copies of "Reading" is two things that can drift apart.
          label: candidate === "all" ? t("filter.all") : g(`resourceStatus.${candidate}`),
        }))}
      />

      {refused ? (
        <Callout tone="danger" live>
          {describe(refused, common)}
        </Callout>
      ) : null}

      {resources.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}

      {resources.isError ? (
        <Callout tone="danger" live>
          <Text>{describe(resources.error, common)}</Text>
          <Row>
            <Button onClick={() => void resources.refetch()}>{common("action.retry")}</Button>
          </Row>
        </Callout>
      ) : null}

      {resources.isSuccess && resources.data.resources.length === 0 ? (
        // Two different facts: an empty library is an invitation, an empty filter is about the filter.
        <Text tone="muted">{filter === "all" ? t("empty.all") : t("empty.filtered")}</Text>
      ) : null}

      {resources.isSuccess ? (
        <Stack>
          {resources.data.resources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              pending={pendingId === resource.id}
              note={renderNote?.(resource.id)}
              links={renderLinks?.(resource)}
              onMarkProgress={(target: Resource, current: number, total: number | null) =>
                progress.mutate({
                  id: target.id,
                  patch: { current, ...(total === null ? {} : { total }) },
                })
              }
              onQueue={(target: Resource) =>
                edit.mutate({ id: target.id, patch: { status: "queued" } })
              }
              onFinish={(target: Resource) => finish.mutate({ id: target.id })}
              onAbandon={(target: Resource) => abandon.mutate({ id: target.id })}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function describe(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
