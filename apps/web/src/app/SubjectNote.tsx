import type { NoteSubject } from "@mindforge/core";
import { useTranslation } from "react-i18next";
import { noteBody, useWriteNote } from "../features/notes/api/use-notes.js";
import { NoteComposer } from "../features/notes/ui/NoteComposer.js";
import { ApiError, NetworkError } from "../shared/api/problem.js";
import { Callout } from "../shared/ui/index.js";

/**
 * A note attached to whatever card you are looking at (FR-N1, and M1's "notes on anything" bullet).
 *
 * Lives in `app/` because it joins the notes feature to resources, skills, and missions, and §2.2
 * rule 6 forbids a feature importing another — so a resource card cannot reach for the composer
 * itself. Cross-feature composition is this layer's job, the same reason `GoalsScreen` exists.
 *
 * **There is no subject picker, and never will be** (§6.14). The card knows what it is, so the subject
 * arrives as a prop — which is what makes this cheap enough to sit on every card rather than being a
 * form you navigate to. FR-N1 describes `standalone` as the escape hatch for the genuinely unfiled
 * thought; until this existed it was the only path the UI offered, which had it backwards.
 *
 * `compact` collapses it to a button until wanted: a permanently-open textarea on every card in a list
 * of twenty would be absurd, and one tap to open is what §7.1 allows for a capture involving typing.
 */
export function SubjectNote({
  subjectType,
  subjectId,
}: {
  readonly subjectType: NoteSubject;
  readonly subjectId: string;
}) {
  const { t: common } = useTranslation("common");
  const write = useWriteNote();

  return (
    <>
      {/* Only a refusal. A note that merely did not arrive has been queued and will land, so an alert
          beside a card you are reading would contradict the shell's pending count — which is the honest
          report because it says "waiting" rather than "failed". */}
      {write.error !== null && !(write.error instanceof NetworkError) ? (
        <Callout tone="danger" live>
          {write.error instanceof ApiError && write.error.problem
            ? write.error.problem.detail
            : common("error.unexpectedBody")}
        </Callout>
      ) : null}

      <NoteComposer
        compact
        pending={write.isPending}
        onWrite={(body) => write.mutate(noteBody({ body, subjectType, subjectId }))}
      />
    </>
  );
}
