/**
 * Enough SemVer to answer one question: is there anything here you have not read? (§14.1)
 *
 * A comparison rather than `newest !== seen`, which looks equivalent and is not. `changelogSeenVersion`
 * is a column a rollback, a hand-edit, or a re-run of `POST /me/changelog-seen` can leave *ahead* of
 * what the build ships — and inequality would then show a dot forever, pointing at nothing. A marker
 * that is sometimes wrong is a marker you learn to ignore, which is the same argument §5.3 makes
 * about manufactured insights.
 */

interface Parsed {
  readonly numbers: readonly number[];
  /** Present means a prerelease, which sorts *below* the release of the same number (SemVer §11). */
  readonly prerelease: string | null;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

function parse(version: string): Parsed | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/** Negative when `a` is older, positive when newer, zero when the same release. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);

  // An unparseable version is not ordered against anything. Treating it as 0.0.0 would make a typo in
  // the changelog announce every release as new.
  if (left === null || right === null) return 0;

  for (let index = 0; index < 3; index += 1) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }

  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/**
 * How many releases are newer than the one you last saw.
 *
 * `null` — never opened — counts every release rather than none. It is a different state from "up to
 * date" precisely because the first time you open the app there *is* something to read.
 */
export function unseenCount(versions: readonly string[], seen: string | null): number {
  if (seen === null) return versions.length;
  return versions.filter((version) => compareVersions(version, seen) > 0).length;
}
