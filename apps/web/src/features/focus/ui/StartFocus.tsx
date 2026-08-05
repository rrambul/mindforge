import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button.js";
import { Field } from "../../../shared/ui/Field.js";

interface StartFocusProps {
  readonly onStart: (intention: string | null) => void;
  readonly starting: boolean;
}

/**
 * The Today screen's one primary action (§5.3): get into a focus session in one tap.
 *
 * The intention field is present but never required. §5.3 asks one question at start — "what
 * does done look like for this block?" — and a question you cannot skip is a question that stops
 * you starting. Submitting empty is a supported path, not a validation failure.
 */
export function StartFocus({ onStart, starting }: StartFocusProps) {
  const { t } = useTranslation("focus");
  const [intention, setIntention] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = intention.trim();
    onStart(trimmed === "" ? null : trimmed);
    setIntention("");
  }

  return (
    <form className="mf-stack" onSubmit={submit}>
      <Field
        label={t("start.intention")}
        hint={t("start.intentionHint")}
        name="intention"
        value={intention}
        onChange={(event) => setIntention(event.target.value)}
        // enterkeyhint so a phone keyboard offers "go" rather than a newline: this is a
        // one-field form and Enter should start the session.
        enterKeyHint="go"
      />
      <div className="mf-row">
        <Button variant="primary" type="submit" disabled={starting}>
          {starting ? t("start.starting") : t("start.submit")}
        </Button>
      </div>
    </form>
  );
}
