import { BANDS, type Band } from "@mindforge/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import {
  Button,
  Callout,
  Field,
  Heading,
  Row,
  Select,
  Spread,
  Stack,
  Text,
  TextareaField,
} from "../../../shared/ui/index.js";
import {
  useAddPrerequisite,
  useCreateSkill,
  useDeleteSkill,
  useRateSkill,
  useRemovePrerequisite,
  useSkills,
  type Skill,
} from "../api/use-skills.js";
import { SkillCard } from "../ui/SkillCard.js";

type Filter = "all" | "overconfident" | Band;

/**
 * The skills screen (FR-S1..S6).
 *
 * The "where I'm overconfident" filter is the reason this screen exists rather than being a list of
 * names: REQUIREMENTS.md calls overconfidence the highest-value thing the app can show, and a list you
 * have to read forty rows of to find it does not show it.
 *
 * In M1 that list is empty for everyone, because scores need evidence and evidence lands in M2. The
 * empty state says so in as many words rather than looking broken.
 */
export function SkillsRoute() {
  const { t } = useTranslation("skills");
  const { t: g } = useTranslation("glossary");
  const { t: common } = useTranslation("common");

  const [filter, setFilter] = useState<Filter>("all");
  const [writing, setWriting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rating, setRating] = useState("");

  const query =
    filter === "all"
      ? {}
      : filter === "overconfident"
        ? { overconfidentOnly: true }
        : { band: filter };

  const skills = useSkills(query);
  // For the prerequisite pickers, which need every skill's name and edges to work out what would close
  // a loop — not just the filtered ones.
  const everySkill = useSkills({});

  const create = useCreateSkill();
  const rate = useRateSkill();
  const addPrereq = useAddPrerequisite();
  const removePrereq = useRemovePrerequisite();
  const remove = useDeleteSkill();

  const pendingId =
    rate.variables?.id ??
    addPrereq.variables?.id ??
    removePrereq.variables?.id ??
    remove.variables?.id;

  const failure = [
    create.error,
    rate.error,
    addPrereq.error,
    removePrereq.error,
    remove.error,
  ].find((error) => error !== null);

  const trimmedName = name.trim();
  const level = Number.parseInt(rating, 10);

  function submit(): void {
    if (trimmedName === "") return;
    create.mutate(
      {
        id: crypto.randomUUID(),
        name: trimmedName,
        ...(description.trim() === "" ? {} : { description: description.trim() }),
        ...(Number.isFinite(level) ? { perceivedLevel: level } : {}),
        prerequisiteIds: [],
      },
      {
        // Cleared only on success, so a duplicate name leaves the typing in place to fix.
        onSuccess: () => {
          setName("");
          setDescription("");
          setRating("");
          setWriting(false);
        },
      },
    );
  }

  return (
    <Stack>
      <Spread>
        <Heading level={1}>{t("heading")}</Heading>
      </Spread>

      <Row>
        <Button variant="primary" onClick={() => setWriting(!writing)}>
          {writing ? t("create.close") : t("create.toggle")}
        </Button>
      </Row>

      {writing ? (
        <Stack>
          <Field
            label={t("create.name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextareaField
            label={t("create.description")}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Field
            label={t("create.rating")}
            hint={t("create.ratingHint")}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={rating}
            onChange={(event) => setRating(event.target.value)}
          />
          <Row>
            <Button
              variant="primary"
              onClick={submit}
              disabled={trimmedName === "" || create.isPending}
            >
              {t("create.action")}
            </Button>
          </Row>
        </Stack>
      ) : null}

      <Select
        label={t("filter.label")}
        value={filter}
        onChange={(event) => setFilter(event.target.value as Filter)}
        options={[
          { value: "all", label: t("filter.all") },
          { value: "overconfident", label: t("filter.overconfident") },
          // Band names from the glossary, so the filter and the chips cannot say different words.
          ...BANDS.map((band) => ({ value: band, label: g(`band.${band}`) })),
        ]}
      />

      {failure ? (
        <Callout tone="danger" live>
          {describe(failure, common)}
        </Callout>
      ) : null}

      {skills.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}

      {skills.isError ? (
        <Callout tone="danger" live>
          <Text>{describe(skills.error, common)}</Text>
          <Row>
            <Button onClick={() => void skills.refetch()}>{common("action.retry")}</Button>
          </Row>
        </Callout>
      ) : null}

      {skills.isSuccess && skills.data.skills.length === 0 ? (
        // Three different facts, and the overconfidence one is its own: that list being empty in M1 is
        // about the app having no evidence yet, not about the user being well calibrated.
        <Text tone="muted">
          {filter === "all"
            ? t("empty.all")
            : filter === "overconfident"
              ? t("empty.noOverconfidence")
              : t("empty.filtered")}
        </Text>
      ) : null}

      {skills.isSuccess ? (
        <Stack>
          {skills.data.skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              allSkills={everySkill.data?.skills ?? skills.data.skills}
              pending={pendingId === skill.id}
              onRate={(target: Skill, perceivedLevel: number) =>
                rate.mutate({ id: target.id, body: { perceivedLevel } })
              }
              onAddPrerequisite={(target: Skill, prereqId: string) =>
                addPrereq.mutate({ id: target.id, body: { prereqId } })
              }
              onRemovePrerequisite={(target: Skill, prereqId: string) =>
                removePrereq.mutate({ id: target.id, prereqId })
              }
              onDelete={(target: Skill) => remove.mutate({ id: target.id })}
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
