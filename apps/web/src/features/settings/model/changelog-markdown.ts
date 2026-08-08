/**
 * The smallest Markdown reader that renders `CHANGELOG.md` honestly.
 *
 * Not a library, and not `dangerouslySetInnerHTML` over one. §14.1 makes the changelog a *reader's*
 * document — the release PR is where commit subjects become sentences — so rendering `**bold**` as
 * literal asterisks would undo the one thing that file is for. But the alternative was pulling in a
 * Markdown parser and an HTML sanitiser to display a build artifact of our own repository, which is
 * a lot of dependency for four constructs.
 *
 * So: the four constructs the file actually uses, parsed into a tree the renderer turns into React
 * elements. Nothing here produces HTML, which is what makes the sanitiser unnecessary rather than
 * merely omitted.
 *
 * Anything it does not recognise stays as text. A parser that dropped what it could not read would
 * lose release notes silently, and a changelog with a hole in it is worse than one with a stray `#`.
 */

export interface Span {
  readonly text: string;
  readonly emphasis?: "strong" | "code";
}

export type Block =
  | { readonly kind: "heading"; readonly spans: readonly Span[] }
  | { readonly kind: "paragraph"; readonly spans: readonly Span[] }
  | { readonly kind: "list"; readonly items: readonly (readonly Span[])[] };

/** `**bold**` and `` `code` ``, non-greedy so two on one line stay two. */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/gu;

export function parseSpans(text: string): readonly Span[] {
  const spans: Span[] = [];

  for (const part of text.split(INLINE)) {
    if (part === "") continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      spans.push({ text: part.slice(2, -2), emphasis: "strong" });
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      spans.push({ text: part.slice(1, -1), emphasis: "code" });
    } else {
      spans.push({ text: part });
    }
  }

  return spans;
}

/**
 * Blocks, in order.
 *
 * Wrapped lines are the case worth naming: `CHANGELOG.md` is hard-wrapped at 100 columns, so a single
 * bullet arrives as three lines and a paragraph as two. Joining continuation lines back together is
 * what stops every wrap becoming a line break on a phone, where the column is a third as wide.
 */
export function parseChangelogBody(body: string): readonly Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: parseSpans(paragraph.join(" ")) });
    paragraph = [];
  }

  function flushList(): void {
    if (items.length === 0) return;
    blocks.push({ kind: "list", items: items.map(parseSpans) });
    items = [];
  }

  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/u.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", spans: parseSpans(heading[1] ?? "") });
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/u.exec(line);
    if (bullet) {
      flushParagraph();
      items.push(bullet[1] ?? "");
      continue;
    }

    // An indented line under a bullet is that bullet wrapping, not a new one.
    if (items.length > 0 && /^\s{2,}/u.test(line)) {
      items[items.length - 1] = `${items[items.length - 1] ?? ""} ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  return blocks;
}
