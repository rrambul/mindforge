/**
 * Query keys that more than one feature has to name.
 *
 * Most keys belong to the feature that owns their endpoint and stay there. These
 * do not, because a write in one feature changes what another feature is showing:
 * recording a lesson's outcome in the reader moves the module fraction, the
 * outcome chip and the "next" badge on the curriculum screen, all of which are
 * read by a different feature's query.
 *
 * The alternative is the lesson feature importing the curriculum feature's `api/`
 * module, which §2.2 rule 6 forbids — or writing `["curriculum", missionId]` by
 * hand in a second place, which works right up until the shape changes and the
 * invalidation silently stops matching anything. `shared/` is where a fact two
 * features share is allowed to live.
 */
export const curriculumKeys = {
  all: ["curriculum"] as const,
  ofMission: (missionId: string) => ["curriculum", missionId] as const,
};
