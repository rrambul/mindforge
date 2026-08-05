import { RESOURCE_TYPES, type ResourceType } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, Row, Select, Stack } from "../../../shared/ui/index.js";

interface AddResourceFormProps {
  readonly onAdd: (input: { type: ResourceType; title: string; author: string | null }) => void;
  readonly pending: boolean;
}

/**
 * The path for something with no URL — a paper book, a course you are enrolled in.
 *
 * A form with fields, unlike capture, and that asymmetry is the point: there is nothing to derive
 * here, so asking is the only option. It stays behind a disclosure so it never competes with the
 * URL box, which is the path used far more often (FR-R2).
 */
export function AddResourceForm({ onAdd, pending }: AddResourceFormProps) {
  const { t } = useTranslation("resources");
  const { t: g } = useTranslation("glossary");

  const [type, setType] = useState<ResourceType>("book");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");

  const trimmedTitle = title.trim();
  const trimmedAuthor = author.trim();

  function submit(): void {
    if (trimmedTitle === "") return;
    onAdd({ type, title: trimmedTitle, author: trimmedAuthor === "" ? null : trimmedAuthor });
    setTitle("");
    setAuthor("");
  }

  return (
    <Stack>
      <Field
        label={t("add.title")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Field
        label={t("add.author")}
        value={author}
        onChange={(event) => setAuthor(event.target.value)}
      />

      <Select
        label={t("add.type")}
        value={type}
        onChange={(event) => setType(event.target.value as ResourceType)}
        options={RESOURCE_TYPES.map((candidate) => ({
          value: candidate,
          label: g(`resourceType.${candidate}`),
        }))}
      />

      <Row>
        <Button variant="primary" onClick={submit} disabled={trimmedTitle === "" || pending}>
          {t("add.action")}
        </Button>
      </Row>
    </Stack>
  );
}
