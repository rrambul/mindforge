import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import {
  Button,
  Callout,
  Field,
  Heading,
  Row,
  Spread,
  Stack,
  Text,
} from "../../../shared/ui/index.js";
import {
  noteBody,
  useDeleteNote,
  useEditNote,
  useNotes,
  useWriteNote,
  type Note,
} from "../api/use-notes.js";
import { NoteCard } from "../ui/NoteCard.js";
import { NoteComposer } from "../ui/NoteComposer.js";

/**
 * The notes screen. Search is the retrieval story (FR-N6), so the search box is the primary control
 * rather than a filter tucked away — with thousands of notes, scrolling is not a plan.
 *
 * Explicitly *not* here, per §6.14: backlinks, a graph view, daily notes, nested pages, templates.
 * Those turn a notes feature into a second product, and this one exists to feed lesson generation
 * and the review queue.
 */
export function NotesRoute() {
  const { t } = useTranslation("notes");
  const { t: common } = useTranslation("common");
  const [query, setQuery] = useState("");

  // Trimmed and treated as absent when empty: sending `q=` would ask the server to match nothing.
  const trimmed = query.trim();
  const notes = useNotes(trimmed === "" ? {} : { q: trimmed });
  const write = useWriteNote();
  const edit = useEditNote();
  const remove = useDeleteNote();

  const pendingId = edit.variables?.id ?? remove.variables?.id;

  return (
    <Stack>
      <Spread>
        <Heading level={1}>{t("heading")}</Heading>
      </Spread>

      <NoteComposer
        onWrite={(body) => write.mutate(noteBody({ body }))}
        pending={write.isPending}
      />

      <Field
        label={t("search")}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // The results update as you type, so a search button would be a control that does nothing.
        enterKeyHint="search"
      />

      {edit.isError || remove.isError ? (
        <Callout tone="danger" live>
          {describe(edit.error ?? remove.error, common)}
        </Callout>
      ) : null}

      {notes.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}

      {notes.isError ? (
        <Callout tone="danger" live>
          <Text>{describe(notes.error, common)}</Text>
          <Row>
            <Button onClick={() => void notes.refetch()}>{common("action.retry")}</Button>
          </Row>
        </Callout>
      ) : null}

      {notes.isSuccess && notes.data.notes.length === 0 ? (
        // Two different empty states, because they mean different things: nothing written yet is an
        // invitation, and nothing matching is a fact about the query.
        <Text tone="muted">{trimmed === "" ? t("empty.body") : t("empty.noMatch")}</Text>
      ) : null}

      {notes.isSuccess ? (
        <Stack>
          {notes.data.notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              pending={pendingId === note.id && (edit.isPending || remove.isPending)}
              onTogglePin={(target: Note) =>
                edit.mutate({ id: target.id, patch: { pinned: !target.pinned } })
              }
              onDelete={(target: Note) => remove.mutate({ id: target.id })}
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
