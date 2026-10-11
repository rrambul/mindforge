import { dirname, join } from "node:path";

/**
 * The lessons' typefaces, served from this origin.
 *
 * A lesson cannot load a font from anywhere else: its CSP is `font-src 'self'
 * data:`, and a learner's lesson should not depend on a third party being up. So
 * the fonts come from installed packages, like Pyodide's files, and every lesson's
 * shared stylesheet starts with `@import url("/fonts/lessons.css")`
 * (`skills/LESSON-SHAPE.md`, "Typography").
 *
 * - **Literata** for prose: a serif drawn for long reading on screens.
 * - **JetBrains Mono** for code.
 *
 * Both are OFL-1.1, and their licences ship in their packages. Only the `latin`
 * and `latin-ext` subsets and only `woff2`, which covers English and Portuguese and
 * every browser that can run a lesson.
 *
 * **The paths never change.** Lesson stylesheets are files in a learner's
 * Storage, written once and kept, so `/fonts/lessons.css` and the file names in it
 * are a contract. An upgrade of a package changes the bytes behind the same names,
 * which is why nothing here is cached as immutable.
 */

export const FONTS_PREFIX = "/fonts/";
export const FONTS_STYLESHEET = `${FONTS_PREFIX}lessons.css`;

const FAMILIES = [
  { pkg: "@fontsource/literata", styles: ["400", "400-italic", "600", "700"] },
  { pkg: "@fontsource/jetbrains-mono", styles: ["400", "700"] },
] as const;

const SUBSETS = new Set(["latin", "latin-ext"]);

export interface FontSet {
  readonly stylesheet: string;
  /** File name → absolute path, for exactly the files the stylesheet names. */
  readonly files: ReadonlyMap<string, string>;
}

/**
 * The stylesheet and the files it names, from the packages' own `@font-face` rules:
 * the wanted subsets kept, the `woff` fallback dropped, every `url()` pointed at
 * this origin's `/fonts/`.
 */
export async function loadFonts(): Promise<FontSet> {
  const blocks: string[] = [];
  const files = new Map<string, string>();

  for (const family of FAMILIES) {
    const dir = dirname(Bun.resolveSync(`${family.pkg}/package.json`, import.meta.dir));
    for (const style of family.styles) {
      const css = await Bun.file(join(dir, `${style}.css`)).text();
      for (const block of fontFaces(css)) {
        if (!SUBSETS.has(block.subset)) continue;
        const name = /url\(\.\/files\/([\w.-]+\.woff2)\)/u.exec(block.text)?.[1];
        if (name === undefined) continue;
        files.set(name, join(dir, "files", name));
        blocks.push(
          block.text.replace(/src:[^;]+;/u, `src: url(${FONTS_PREFIX}${name}) format('woff2');`),
        );
      }
    }
  }

  return { stylesheet: `${blocks.join("\n\n")}\n`, files };
}

/** Each `@font-face` rule with the subset its leading comment names. */
export function fontFaces(css: string): { subset: string; text: string }[] {
  const found: { subset: string; text: string }[] = [];
  const pattern = /\/\* ([\w-]+?)-(\d{3})-(?:normal|italic) \*\/\s*(@font-face\s*\{[^}]*\})/gu;
  for (const match of css.matchAll(pattern)) {
    const [, prefix, , text] = match;
    // `literata-latin-ext` → `latin-ext`: the family name is a prefix of every
    // file, so the subset is whatever follows the first known subset word.
    const subset = /(?:^|-)((?:latin|cyrillic|greek|vietnamese|math|symbols)(?:-ext)?)$/u.exec(
      prefix!,
    )?.[1];
    if (subset !== undefined) found.push({ subset, text: text! });
  }
  return found;
}
