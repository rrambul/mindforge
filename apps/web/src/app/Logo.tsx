import { useId } from "react";

/**
 * The Mindforge mark: an anvil, the temper run laid across its face, a spark struck off the heel.
 *
 * Lives in `app/` for the same reason `AppShell` does (§2.2 rule 7) — there is exactly one of it,
 * and promoting a single-use component into the design system is how that system becomes a junk
 * drawer.
 *
 * Two things it deliberately does NOT do:
 *
 * 1. **No raw colours.** The steel is `currentColor`, so the mark takes the ink of whatever it sits
 *    in, and the temper run and the spark read `--mf-band-*` and `--mf-ember` straight off the token
 *    sheet. That is not tidiness — `tokens.css` redefines every band under `[data-theme="dark"]`, so
 *    pointing at the variables is what makes the mark re-temper itself when the theme toggles.
 *    Literal hexes would leave it lit for the light ground forever.
 *
 * 2. **No label.** It is `aria-hidden` because the only place it appears is beside the wordmark, and
 *    a screen reader announcing "Mindforge Mindforge" is worse than silence. Any future use of the
 *    mark on its own needs to supply its own accessible name.
 *
 * `public/favicon.svg` is the same three paths with literal colours, because a favicon renders in
 * browser chrome where the token sheet does not exist. If the geometry here changes, change it there
 * too and run `pnpm icons`.
 */
export function Logo({ size = 20 }: { readonly size?: number }) {
  // The gradient is referenced by id, and the shell is not the only thing that may ever render this.
  // Two Logos on one page with a hardcoded id means the second one silently paints with the first
  // one's stops — which, since both are identical today, would go unnoticed until they were not.
  const run = useId();

  return (
    <svg
      className="mf-logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Coolest band at the horn, heating toward the heel where the spark just came off. The run
            stops at x=26 and pads, so the heel under the spark is solid ember. Straw is omitted:
            between bronze and ember it is a light value in a dark neighbourhood, and below about
            24px it reads as a hole punched through the face. */}
        <linearGradient id={run} gradientUnits="userSpaceOnUse" x1="4" y1="15" x2="26" y2="15">
          <stop offset="0" stopColor="var(--mf-band-teaching)" />
          <stop offset="0.28" stopColor="var(--mf-band-fluent)" />
          <stop offset="0.55" stopColor="var(--mf-band-working)" />
          <stop offset="0.8" stopColor="var(--mf-band-assisted)" />
          <stop offset="1" stopColor="var(--mf-ember)" />
        </linearGradient>
      </defs>
      {/* The spark, over the heel. It is what a strike leaves, so it sits where the run is hottest. */}
      <path
        fill="var(--mf-ember)"
        d="M24 1.5l1.6 2.9 2.9 1.6-2.9 1.6-1.6 2.9-1.6-2.9L19.5 6l2.9-1.6z"
      />
      {/* The face and horn, carrying the run. Cut square on a 32-unit grid so the slab's edges land
          on whole pixels at 16 and 32; only the horn and the waist go off-axis. */}
      <path fill={`url(#${run})`} d="M2 15l4-3h24v6H8z" />
      {/* The waist and base, in steel. */}
      <path fill="currentColor" d="M25 18l-2 4 5 3v3H8v-3l5-3-2-4z" />
    </svg>
  );
}
