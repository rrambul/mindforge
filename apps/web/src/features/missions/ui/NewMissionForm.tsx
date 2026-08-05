import { zodResolver } from "@hookform/resolvers/zod";
import {
  CreateMissionSchema,
  type CreateMissionFormValues,
  type CreateMissionInput,
} from "@mindforge/core";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button.js";
import { Field, TextareaField } from "../../../shared/ui/Field.js";

interface NewMissionFormProps {
  readonly onSubmit: (input: CreateMissionInput) => void;
  readonly pending: boolean;
  readonly onCancel: () => void;
  /** Server-side field errors, already translated. */
  readonly serverErrors: ReadonlyMap<string, string>;
}

/**
 * The form the guided first mission (§5.3) will reuse. Its first two questions are
 * step 1 of that flow — "what do you want to get better at, and why" — asked in that
 * order because the `why` is what the teach agent grounds everything on.
 *
 * Validated against the same Zod schema the API validates with (§2.2 rule 3), so the
 * client cannot accept a topic the server will reject. The server still validates:
 * this is a faster answer, not a substitute.
 */
export function NewMissionForm({ onSubmit, pending, onCancel, serverErrors }: NewMissionFormProps) {
  const { t } = useTranslation("missions");

  // Three type parameters, because the schema's input and output differ: the form holds
  // `""` for an untouched textarea, and the schema turns that into null before the
  // handler sees it.
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateMissionFormValues, unknown, CreateMissionInput>({
    resolver: zodResolver(CreateMissionSchema),
    defaultValues: { topic: "", why: "", successLooksLike: "", constraints: "", currentLevel: "" },
  });

  /**
   * Client error first, then the server's. They cannot both be live — a submit only
   * reaches the server once the client is satisfied — and preferring the client's keeps
   * the message next to the keystroke that caused it.
   */
  function errorFor(field: keyof CreateMissionInput, code: string | undefined): string | undefined {
    if (code) return t(`field.${field}.${code}`, { defaultValue: code });
    return serverErrors.get(field);
  }

  return (
    <form className="mf-stack" onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
      <h2 className="mf-h2">{t("new.heading")}</h2>

      <Field
        label={t("new.topic")}
        hint={t("new.topicHint")}
        autoFocus
        {...register("topic")}
        error={errorFor("topic", errors.topic?.type)}
      />

      <TextareaField
        label={t("new.why")}
        hint={t("new.whyHint")}
        rows={3}
        {...register("why")}
        error={errorFor("why", errors.why?.type)}
      />

      <TextareaField
        label={t("new.successLooksLike")}
        rows={2}
        {...register("successLooksLike")}
        error={errorFor("successLooksLike", errors.successLooksLike?.type)}
      />

      <div className="mf-row">
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? t("new.creating") : t("new.submit")}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t("action.cancel", { ns: "common" })}
        </Button>
      </div>
    </form>
  );
}
