import { useTranslation } from "react-i18next";
import { Button, Card, Row, Spread, StatusChip, Text } from "../../../shared/ui/index.js";
import type { Note } from "../api/use-notes.js";
import "./note-card.css";

interface NoteCardProps {
  readonly note: Note;
  readonly onTogglePin: (note: Note) => void;
  readonly onDelete: (note: Note) => void;
  readonly pending: boolean;
}

/**
 * Dumb by design: props in, markup out.
 *
 * A highlight renders its quote above the note, because the quote is what you were responding to and
 * reading the response first is backwards. Both are searched (the generated column concatenates
 * them), so a highlight is findable by either.
 */
export function NoteCard({ note, onTogglePin, onDelete, pending }: NoteCardProps) {
  const { t } = useTranslation("notes");
  const { t: g } = useTranslation("glossary");

  return (
    <Card as="article" variant={note.pinned ? "raised" : "muted"}>
      <Spread>
        {/* The subject, translated from a key — the column stores `focus_session` (§5.2). */}
        <StatusChip>{g(`noteSubject.${note.subjectType}`)}</StatusChip>
        {note.pinned ? <StatusChip>{t("pinned")}</StatusChip> : null}
      </Spread>

      {note.quote ? (
        <blockquote className="mf-note-quote">
          <Text tone="muted">{note.quote}</Text>
        </blockquote>
      ) : null}

      <Text>{note.body}</Text>

      <Row>
        <Button onClick={() => onTogglePin(note)} disabled={pending}>
          {note.pinned ? t("unpin") : t("pin")}
        </Button>
        <Button variant="quiet" onClick={() => onDelete(note)} disabled={pending}>
          {t("delete")}
        </Button>
      </Row>
    </Card>
  );
}
