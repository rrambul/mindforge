import { z } from "zod";

import { IsoDateSchema } from "./common.js";

/**
 * Committing to — or moving — a module's deadline (FR-U2):
 * `PUT /v1/missions/:missionId/modules/:moduleId/deadline`.
 *
 * One field, a calendar day in the learner's timezone. Whether it is today or later
 * is checked by the server, which knows what "today" is for this learner; a
 * schema cannot. Every commit is a new row, so there is nothing else to send — the
 * history is the server's to keep.
 */
/**
 * The range `module_deadlines_due_on_plausible` accepts, checked here too so a year
 * typed wrong is a validation error the learner can read rather than a constraint
 * violation the API reports as a 500. ISO dates compare as strings in calendar order.
 */
export const DEADLINE_EARLIEST = "2020-01-01";
export const DEADLINE_LATEST = "2100-12-31";

export const SetDeadlineSchema = z.object({
  dueOn: IsoDateSchema.refine((day) => day >= DEADLINE_EARLIEST && day <= DEADLINE_LATEST, {
    error: `Expected a date from ${DEADLINE_EARLIEST} to ${DEADLINE_LATEST}`,
  }),
});
export type SetDeadlineInput = z.infer<typeof SetDeadlineSchema>;
