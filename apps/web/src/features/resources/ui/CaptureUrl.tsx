import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, Row } from "../../../shared/ui/index.js";

interface CaptureUrlProps {
  readonly onCapture: (url: string) => void;
  readonly pending: boolean;
}

/**
 * FR-R2's whole surface: one box, one button.
 *
 * Deliberately not a form with a type picker and a title field. The server guesses the type and
 * fetches the title, and both are correctable in one tap afterwards — asking up front would cost a
 * tap on every capture to save one on the few that guess wrong.
 *
 * Cleared optimistically, like the note composer: the capture is queued if it cannot reach the
 * server, so holding the text hostage to a round trip would be the one thing the budget forbids.
 */
export function CaptureUrl({ onCapture, pending }: CaptureUrlProps) {
  const { t } = useTranslation("resources");
  const [url, setUrl] = useState("");

  const trimmed = url.trim();

  function submit(): void {
    if (trimmed === "") return;
    onCapture(trimmed);
    setUrl("");
  }

  return (
    <Row>
      <Field
        label={t("capture.label")}
        hint={t("capture.hint")}
        type="url"
        // `url` rather than `text`: on a phone this is the difference between a keyboard with a
        // slash and one without.
        inputMode="url"
        autoComplete="off"
        enterKeyHint="send"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => {
          // Paste-and-Enter is the fastest possible path, and it is what a share sheet lands you in.
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <Button variant="primary" onClick={submit} disabled={trimmed === ""}>
        {pending ? t("capture.pending") : t("capture.action")}
      </Button>
    </Row>
  );
}
