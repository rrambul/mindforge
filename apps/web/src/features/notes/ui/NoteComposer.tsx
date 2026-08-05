import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Row, Stack, TextareaField } from "../../../shared/ui/index.js";

interface NoteComposerProps {
  readonly onWrite: (body: string) => void;
  readonly pending: boolean;
  /** Compact enough to sit inside the running-session bar without crowding the thumb zone. */
  readonly compact?: boolean;
}

/**
 * FR-N3 — one tap from a running session.
 *
 * Collapsed to a single button until you want it, because the running-session block *is* the bottom
 * bar on mobile (§5.1) and a permanently-open textarea there would push Stop and the friction chips
 * out of reach. One tap opens it, which is the budget §7.1 allows for a capture that involves typing.
 *
 * There is no subject picker and never will be: the caller knows what you were doing (§6.14).
 */
export function NoteComposer({ onWrite, pending, compact = false }: NoteComposerProps) {
  const { t } = useTranslation("notes");
  const [open, setOpen] = useState(!compact);
  const [body, setBody] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = body.trim();
    if (trimmed === "") return;
    onWrite(trimmed);
    // Cleared immediately rather than on success: the write is optimistic and queued if it cannot
    // reach the server, so holding the text hostage to a round trip would be the one thing the
    // capture budget forbids.
    setBody("");
    if (compact) setOpen(false);
  }

  if (!open) {
    return (
      <Row>
        <Button variant="quiet" onClick={() => setOpen(true)}>
          {t("open")}
        </Button>
      </Row>
    );
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="tight">
        <TextareaField
          label={t("label")}
          rows={compact ? 2 : 3}
          value={body}
          autoFocus={compact}
          onChange={(event) => setBody(event.target.value)}
        />
        <Row>
          <Button variant="primary" type="submit" disabled={pending || body.trim() === ""}>
            {t("save")}
          </Button>
          {compact ? (
            <Button
              variant="quiet"
              onClick={() => {
                setBody("");
                setOpen(false);
              }}
            >
              {t("close")}
            </Button>
          ) : null}
        </Row>
      </Stack>
    </form>
  );
}
