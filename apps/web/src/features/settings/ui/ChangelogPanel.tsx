import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Figure, Spread, Stack, Text } from "../../../shared/ui/index.js";
import type { Release } from "../api/use-changelog.js";
import { parseChangelogBody, type Span } from "../model/changelog-markdown.js";
import { releaseDateLabel } from "../model/labels.js";
import "./settings.css";

/**
 * Settings → What's new (§14.1): the full history, newest first.
 *
 * Rendered in whatever language the entries were written in, and deliberately not translated. They
 * are not UI strings — they live in `CHANGELOG.md`, they are rewritten by hand at release time, and
 * routing them through the locale bundles would mean `pnpm check:i18n` blocking every release until
 * its own notes had a pt-BR twin.
 */
export function ChangelogPanel({ releases }: { readonly releases: readonly Release[] }) {
  const { t, i18n } = useTranslation("settings");

  if (releases.length === 0) {
    return <Text tone="muted">{t("changelog.empty")}</Text>;
  }

  return (
    <Stack>
      {releases.map((release) => {
        const date = releaseDateLabel(i18n.language, release.date);

        return (
          <article className="mf-release" key={release.version} aria-label={release.version}>
            <Spread>
              <Figure>{release.version}</Figure>
              {/* No date rather than a guessed one: an entry written before release-please dated the
                  heading has no date, and any we invented would be the day the parser ran. */}
              {date === null ? null : (
                <Text as="span" tone="muted">
                  {date}
                </Text>
              )}
            </Spread>
            <ReleaseBody body={release.body} />
          </article>
        );
      })}
    </Stack>
  );
}

function ReleaseBody({ body }: { readonly body: string }) {
  return (
    <>
      {parseChangelogBody(body).map((block, index) => {
        // Index keys: blocks have no identity of their own and the list is static for a given
        // release, so there is nothing for a stable key to protect against.
        const key = `${block.kind}-${String(index)}`;

        if (block.kind === "heading") {
          // An h3, not `Heading`: the release version above it is already the section's title, and a
          // display-sized heading inside a card would outweigh the card's own.
          return (
            <h3 className="mf-release__heading" key={key}>
              <Spans spans={block.spans} />
            </h3>
          );
        }

        if (block.kind === "list") {
          return (
            <ul className="mf-release__list" key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${String(itemIndex)}`}>
                  <Spans spans={item} />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <Text key={key}>
            <Spans spans={block.spans} />
          </Text>
        );
      })}
    </>
  );
}

function Spans({ spans }: { readonly spans: readonly Span[] }) {
  return (
    <>
      {spans.map((span, index) => (
        <Fragment key={`${String(index)}-${span.text}`}>
          {span.emphasis === "strong" ? (
            <strong>{span.text}</strong>
          ) : span.emphasis === "code" ? (
            <code className="mf-release__code">{span.text}</code>
          ) : (
            span.text
          )}
        </Fragment>
      ))}
    </>
  );
}
