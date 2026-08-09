import { useTranslation } from "react-i18next";

import { Button, Card, Heading, Row, Stack, StatusChip, Text } from "../../../shared/ui/index.js";
import {
  useConfirmMemory,
  useForgetMemory,
  useMemories,
  type MemoryView,
} from "../api/use-memory.js";

/**
 * What the agent has concluded about you, and your say in it (§7.6).
 *
 * On Settings rather than on a mission, because it spans every mission — that is
 * the whole reason it exists separately from `NOTES.md`.
 *
 * Three deliberate choices about how it reads:
 *
 * 1. **Empty is explained, not blank.** §7.6 says don't build an onboarding
 *    questionnaire, so a new account genuinely has nothing here — and "nothing
 *    yet, the agent writes this as it teaches you" is a different message from a
 *    screen that looks broken.
 * 2. **Superseded entries stay, dimmed.** That a stated preference changed is
 *    itself information. Hiding the old one would hide the change.
 * 3. **Confirm is offered, never assumed.** Silence is not agreement, and an
 *    unconfirmed memory is not a wrong one — so the absence of a mark says
 *    "unreviewed" rather than anything about its truth.
 */
export function LearnerMemory() {
  const { t } = useTranslation("memory");
  const memories = useMemories();

  return (
    <Card as="section" label={t("heading")}>
      <Stack>
        <Heading level={2}>{t("heading")}</Heading>
        <Text tone="muted">{t("intro")}</Text>

        {memories.data?.length === 0 ? (
          <Text tone="hint">{t("empty")}</Text>
        ) : (
          memories.data?.map((memory) => <MemoryRow key={memory.id} memory={memory} />)
        )}
      </Stack>
    </Card>
  );
}

function MemoryRow({ memory }: { readonly memory: MemoryView }) {
  const { t } = useTranslation("memory");
  const { t: g } = useTranslation("glossary");
  const confirm = useConfirmMemory();
  const forget = useForgetMemory();

  const superseded = memory.supersededBySlug !== null;
  const busy =
    (confirm.isPending && confirm.variables === memory.id) ||
    (forget.isPending && forget.variables === memory.id);

  return (
    <Stack gap="tight">
      <Row>
        {/* A key, translated at render — the column stores `learning_pattern` (§5.2). */}
        <StatusChip>{g(`memoryKind.${memory.kind}`)}</StatusChip>
        {memory.confirmedAt !== null && <StatusChip>{t("confirmed")}</StatusChip>}
        {superseded && <StatusChip>{t("superseded")}</StatusChip>}
      </Row>

      <Text tone={superseded ? "hint" : "body"}>{memory.summary}</Text>

      {superseded ? (
        <Text tone="hint">{t("supersededBy", { slug: memory.supersededBySlug })}</Text>
      ) : (
        <Row>
          {memory.confirmedAt === null && (
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                confirm.mutate(memory.id);
              }}
            >
              {t("action.confirm")}
            </Button>
          )}
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => {
              forget.mutate(memory.id);
            }}
          >
            {t("action.forget")}
          </Button>
        </Row>
      )}
    </Stack>
  );
}
