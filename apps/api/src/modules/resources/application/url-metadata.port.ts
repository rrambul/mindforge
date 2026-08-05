export const URL_METADATA = Symbol("UrlMetadata");

export interface UrlMetadata {
  readonly title: string | null;
  readonly author: string | null;
}

/**
 * Reads a page's own description of itself.
 *
 * A port because FR-R2 makes this the make-or-break path and it is the one thing here that touches
 * the network: the use case has to be testable without it, and the adapter has to be swappable when
 * OpenGraph inevitably fails on some site that matters.
 *
 * Returning nulls rather than throwing is part of the contract. A capture whose title could not be
 * fetched is still a successful capture — the URL is the thing worth keeping, and a failed lookup
 * that lost it would be the worst possible outcome on the product's most-used path.
 */
export interface UrlMetadataReader {
  read(url: string): Promise<UrlMetadata>;
}
