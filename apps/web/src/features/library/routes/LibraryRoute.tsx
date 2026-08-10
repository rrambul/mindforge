import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  Heading,
  Row,
  Spread,
  Stack,
  Text,
} from "../../../shared/ui/index.js";
import {
  useLearningRecords,
  useReferenceDocs,
  type LearningRecord,
  type ReferenceDoc,
} from "../api/use-library.js";
import { LearningRecordCard } from "../ui/LearningRecordCard.js";

export interface LibraryRouteProps {
  readonly missionId: string;
  /** Back to the curriculum, handed in by the app layer — it owns the route table. */
  readonly back?: ReactNode;
}

/**
 * A mission's reference shelf and its written record (FR-T6).
 *
 * Two sections rather than two screens, because they answer the same question at
 * different distances: *what do I already have on this topic*. The reference docs
 * are what the agent wrote to be revisited, and the records are what happened.
 *
 * **A reference doc opens in a new tab rather than in the sandboxed frame.** It is
 * a document you keep beside the work, and a frame inside the app is the one place
 * you cannot leave it open while doing something else. It is still served from the
 * lessons origin with the same headers, so nothing about the isolation changes —
 * `noreferrer` is what keeps the grant in the URL from reaching anything the page
 * links out to.
 */
export function LibraryRoute({ missionId, back }: LibraryRouteProps) {
  const { t } = useTranslation("library");
  const docs = useReferenceDocs(missionId);
  const records = useLearningRecords(missionId);

  return (
    <Stack gap="loose">
      <Stack gap="tight">
        {back}
        <Heading level={1}>{t("heading")}</Heading>
        <Text tone="muted">{t("intro")}</Text>
      </Stack>

      <Card as="section" label={t("reference.heading")}>
        <Stack gap="tight">
          <Heading level={2}>{t("reference.heading")}</Heading>
          <Loaded query={docs}>
            {(data) =>
              data.docs.length === 0 ? (
                <Text tone="hint">{t("reference.empty")}</Text>
              ) : (
                <Stack gap="tight">
                  {data.docs.map((doc) => (
                    <ReferenceRow key={doc.id} doc={doc} />
                  ))}
                </Stack>
              )
            }
          </Loaded>
        </Stack>
      </Card>

      <Card as="section" label={t("records.heading")}>
        <Stack gap="tight">
          <Heading level={2}>{t("records.heading")}</Heading>
          <Loaded query={records}>
            {(data) =>
              data.records.length === 0 ? (
                <Text tone="hint">{t("records.empty")}</Text>
              ) : (
                <Stack gap="tight">
                  {data.records.map((record: LearningRecord) => (
                    <LearningRecordCard key={record.id} record={record} />
                  ))}
                </Stack>
              )
            }
          </Loaded>
        </Stack>
      </Card>
    </Stack>
  );
}

function ReferenceRow({ doc }: { readonly doc: ReferenceDoc }) {
  const { t } = useTranslation("library");

  return (
    <Spread>
      <Text>{doc.title}</Text>
      {doc.url === null ? (
        <Text tone="hint">{t("reference.unavailable")}</Text>
      ) : (
        <ButtonLink href={doc.url} target="_blank" variant="quiet">
          {t("reference.open")}
        </ButtonLink>
      )}
    </Spread>
  );
}

/** Loading and failure, the same shape every read screen uses. */
function Loaded<T>({
  query,
  children,
}: {
  readonly query: UseQueryResult<T>;
  readonly children: (data: T) => ReactNode;
}) {
  const { t: common } = useTranslation("common");

  if (query.isError) {
    return (
      <Callout tone="danger" live>
        <Text>{describe(query.error, common)}</Text>
        <Row>
          <Button onClick={() => void query.refetch()}>{common("action.retry")}</Button>
        </Row>
      </Callout>
    );
  }

  if (!query.isSuccess) return <Text tone="muted">{common("state.loading")}</Text>;

  return <>{children(query.data)}</>;
}

function describe(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
