import { writeFileSync } from "node:fs";

import { localDay, missionProgress, moduleProgress, type LessonNode } from "@mindforge/core";

import { connect } from "./seed-support.js";

/**
 * Export one learner's curriculum progress as a snapshot the portfolio commits.
 *
 * Mindforge runs against a local Supabase and is not deployed, so there is no
 * endpoint renanrambul.dev could call. A committed snapshot is the transport:
 * the site stays fully static, no public read path is opened over user-scoped
 * rows, and the numbers move when a commit says they moved.
 *
 * Two rules it inherits from the app, deliberately:
 *
 * 1. **Nothing derived is invented here.** The fractions come from
 *    `moduleProgress` and `missionProgress` in `packages/core` — the same
 *    functions the API and the SPA call (non-negotiable 3). A second
 *    implementation living in an export script is exactly how a public number
 *    starts disagreeing with the private one.
 * 2. **Unknown is not zero.** A module with no lessons has no fraction, so it
 *    is written as null and the page says "not planned yet" rather than drawing
 *    a measured-looking 0/0.
 *
 *   pnpm --filter @mindforge/db export:portfolio
 *   pnpm --filter @mindforge/db export:portfolio -- --email=you@example.com --out=/path/mindforge.ts
 */

interface Options {
  readonly email: string;
  readonly out: string;
}

/**
 * Curricula that stay off the public page, by their exported topic.
 *
 * Not every mission is something to publish: what I am learning about my own
 * money is mine, and a page that lists it is a fact about me rather than about
 * my work. Kept here rather than as a column on `missions` because it is a
 * property of one website's audience, not of the curriculum.
 *
 * A name that matches nothing is reported rather than ignored — otherwise
 * renaming a mission republishes it silently, which is the one failure this
 * list exists to prevent.
 */
const PRIVATE_TOPICS: readonly string[] = ["Personal finances and investing in Brazil"];

/** Sibling checkout: `~/brain-gym` and `~/portifolio`. Override with `--out`. */
const DEFAULT_OUT = new URL("../../../../portifolio/src/data/mindforge.ts", import.meta.url)
  .pathname;

function parse(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([\w-]+)=(.*)$/u.exec(arg);
    if (match) flags.set(match[1]!, match[2]!);
  }
  return {
    email: flags.get("email") ?? "sysdesign@mindforge.local",
    out: flags.get("out") ?? DEFAULT_OUT,
  };
}

/**
 * The public name of a mission.
 *
 * A mission topic is written to brief an agent, so it is a sentence: "AWS —
 * taking systems I design into production." The portfolio bans em-dashes in copy
 * and the page has one narrow column, so the lead is what ships and the rest is
 * the brief. Trailing punctuation goes with it.
 */
function shortTopic(topic: string): string {
  const lead = topic.split(/\s+[—–-]\s+/u)[0]!.split(/[.:]\s/u)[0]!;
  return lead.replace(/[.\s]+$/u, "");
}

function main(): Promise<void> {
  return run(parse(process.argv.slice(2)));
}

async function run(options: Options): Promise<void> {
  const prisma = connect();

  try {
    const [user] = await prisma.$queryRawUnsafe<{ id: string; timezone: string }[]>(
      `select u.id, p.timezone from auth.users u join profiles p on p.id = u.id where u.email = $1`,
      options.email,
    );
    if (!user) throw new Error(`No account for ${options.email}.`);

    const missions = await prisma.mission.findMany({
      where: { userId: user.id, status: "active" },
      orderBy: { createdAt: "asc" },
      select: {
        topic: true,
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            status: true,
            lessons: {
              select: { id: true, status: true, completedAt: true },
            },
          },
        },
      },
    });

    const exported = missions
      .map((mission) => {
        // `isShown` in GetCurriculum: a dropped module is kept only when it holds
        // work that was actually done, so finished lessons never vanish from the
        // one place that lists them.
        const tracks = mission.tracks.filter(
          (track) =>
            track.status !== "dropped" ||
            track.lessons.some((lesson) => lesson.status === "generated"),
        );

        const modules = tracks.map((track) => {
          const nodes = track.lessons.map(toNode);
          return { name: track.name, progress: moduleProgress(nodes) };
        });

        return {
          topic: shortTopic(mission.topic),
          progress: missionProgress(modules.map((module) => module.progress)),
          modules: modules.map((module) => ({
            name: module.name,
            completed: module.progress?.completed ?? null,
            total: module.progress?.total ?? null,
          })),
        };
      })
      // Started, not merely planned. A curriculum I have not opened a lesson of is
      // an intention, and a public page listing four of those at 0/87 is a claim
      // about ambition rather than about work. Each one appears here the moment its
      // first lesson is finished, which also means the export needs no list of
      // which missions are fit to show.
      .filter((mission) => mission.progress !== null && mission.progress.completed > 0)
      .filter((mission) => !PRIVATE_TOPICS.includes(mission.topic));

    // The learner's own day, not the server's. A snapshot stamped with tomorrow's
    // date because the export ran at 21:30 in Sao Paulo would be a small lie on a
    // page whose whole point is not telling them.
    //
    // `Date.now()` rather than a bare `new Date()`: the repo-wide lint rule bans the
    // argless form because it makes time-derived code untestable, and an export is
    // one of the few places that genuinely means "right now".
    const today = localDay(new Date(Date.now()), user.timezone);

    const published = new Set(missions.map((mission) => shortTopic(mission.topic)));
    for (const topic of PRIVATE_TOPICS) {
      if (!published.has(topic)) {
        console.warn(
          `warning: "${topic}" is on the private list and matches no mission. ` +
            `If it was renamed, update PRIVATE_TOPICS or it will be published.`,
        );
      }
    }

    writeFileSync(options.out, render(exported, today), "utf8");

    const lessons = exported.reduce((sum, m) => sum + (m.progress?.completed ?? 0), 0);
    const count = exported.length === 1 ? "1 mission" : `${exported.length} missions`;
    console.log(`${options.out}\n  ${count}, ${lessons} lessons completed`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * As much of a lesson row as the fraction needs.
 *
 * The graph functions take a `LessonNode`, and the fields they do not read are
 * filled with nulls rather than queried: an export has no business pulling a
 * lesson's storage path through a maths function.
 */
function toNode(lesson: { id: string; status: string; completedAt: Date | null }): LessonNode {
  return {
    id: lesson.id,
    trackId: null,
    status: lesson.status as LessonNode["status"],
    difficulty: null,
    position: null,
    seq: null,
    completed: lesson.completedAt !== null,
    prerequisiteIds: [],
  };
}

interface ExportedMission {
  readonly topic: string;
  readonly progress: { readonly completed: number; readonly total: number } | null;
  readonly modules: readonly {
    readonly name: string;
    readonly completed: number | null;
    readonly total: number | null;
  }[];
}

/** The portfolio's `src/data/mindforge.ts`, whole. Prettier formats it on commit. */
function render(missions: readonly ExportedMission[], today: string): string {
  const body = missions.map(renderMission).join(",\n");

  return `// Generated by \`pnpm --filter @mindforge/db export:portfolio\` in the
// mindforge repo. Do not edit by hand: the next export overwrites it.
//
// A snapshot, not a feed. Mindforge runs locally, so these numbers are as fresh
// as the last commit, and a plan that gains or loses lessons shows up here as a
// diff rather than silently rewriting a public page.
import type { ForgeSnapshot } from "@/types/forge";

export const forge: ForgeSnapshot = {
  snapshotAt: "${today}",
  missions: [
${body},
  ],
};
`;
}

function renderMission(mission: ExportedMission): string {
  const modules = mission.modules
    .map(
      (module) =>
        `        { name: ${JSON.stringify(module.name)}, completed: ${module.completed}, total: ${module.total} }`,
    )
    .join(",\n");

  return `    {
      topic: ${JSON.stringify(mission.topic)},
      completed: ${mission.progress!.completed},
      total: ${mission.progress!.total},
      modules: [
${modules},
      ],
    }`;
}

await main();
