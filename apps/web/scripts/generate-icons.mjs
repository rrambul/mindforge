#!/usr/bin/env node
/**
 * Rasterises every icon the app ships from the one SVG in `public/favicon.svg`.
 *
 * Icon sets rot the moment they are hand-maintained: the .ico gets updated, the
 * apple-touch icon does not, and nobody notices for a year because the two are never
 * on screen at the same time. So there is exactly one drawing of the mark, and
 * everything else is output. Change `public/favicon.svg`, run `pnpm icons`, commit
 * what changed.
 *
 * Chromium does the rasterising because it is already installed for Playwright and
 * it is the same engine that will render the SVG favicon in the tab — a mark that
 * looks right here looks right there. The alternative (librsvg, ImageMagick, sharp)
 * is a native dependency added for one occasional task.
 *
 * Generated files ARE committed. This script is not part of `build`: CI has no
 * browser download and a deploy must not depend on one.
 */

import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
// From @playwright/test, not `playwright`: the test runner is the declared dependency
// and it re-exports the launchers, so importing the driver package directly would work
// under a hoisting node_modules layout and fail under pnpm's.
import { chromium } from "@playwright/test";

const publicDir = new URL("../public/", import.meta.url);

/** --mf-ground, light. Copied from src/styles/tokens.css. */
const PLATE = "#e9ecee";

/**
 * How much of each canvas the mark occupies.
 *
 * The .ico sizes get the full canvas: the mark already carries 2/32 of margin inside
 * its own grid, and at 16px any further inset costs pixels the glyph cannot spare.
 * The installed-app icons get a deep inset instead, because Android's maskable spec
 * can crop to a circle inscribed in the middle 80%, and iOS applies its own corner
 * radius — art that runs to the edge loses its corners on both.
 */
const TARGETS = [
  { file: "apple-touch-icon.png", size: 180, inset: 0.64 },
  { file: "icon-192.png", size: 192, inset: 0.6 },
  { file: "icon-512.png", size: 512, inset: 0.6 },
];

/** Windows and older Safari still ask for these; browsers that read SVG never do. */
const ICO_SIZES = [16, 32, 48];

/**
 * The .ico container. Six bytes of header, then one sixteen-byte directory entry per
 * image, then the images themselves — which are whole PNG files, not bitmaps. Every
 * browser in use has understood PNG-in-ICO since Vista, and it saves hand-rolling
 * the BMP-with-inverted-rows-and-a-separate-AND-mask format that preceded it.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon, 2 = cursor
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, data }, i) => {
    const at = i * 16;
    // 256 is written as 0 — the field is one byte and 256 does not fit. Nothing here
    // is that large, but the encoding is a trap worth not leaving armed.
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size; 0 for truecolour
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

const page = (svg, size, inset, plate) => `
  <style>
    html, body { margin: 0; padding: 0; }
    body {
      width: ${size}px;
      height: ${size}px;
      display: grid;
      place-items: center;
      background: ${plate};
    }
    svg { display: block; width: ${size * inset}px; height: ${size * inset}px; }
  </style>
  ${svg}
`;

async function main() {
  const svg = await readFile(new URL("favicon.svg", publicDir), "utf8");

  const browser = await chromium.launch();
  // Pinned rather than inherited: the mark's steel is #161d22 under a light scheme
  // and #c9d2d8 under a dark one, and every raster here sits on a light plate. A
  // machine whose OS is in dark mode would otherwise produce pale-on-pale icons.
  const context = await browser.newContext({ colorScheme: "light" });

  const shoot = async (size, inset, plate) => {
    const tab = await context.newPage();
    await tab.setViewportSize({ width: size, height: size });
    await tab.setContent(page(svg, size, inset, plate), { waitUntil: "load" });
    const buffer = await tab.screenshot({ omitBackground: plate === "transparent" });
    await tab.close();
    return buffer;
  };

  const written = [];

  for (const { file, size, inset } of TARGETS) {
    await writeFile(new URL(file, publicDir), await shoot(size, inset, PLATE));
    written.push(`${file} (${size}px)`);
  }

  const ico = [];
  for (const size of ICO_SIZES) {
    ico.push({ size, data: await shoot(size, 1, PLATE) });
  }
  await writeFile(new URL("favicon.ico", publicDir), buildIco(ico));
  written.push(`favicon.ico (${ICO_SIZES.join(", ")}px)`);

  await context.close();
  await browser.close();

  console.log(`Wrote ${written.length} files to apps/web/public:`);
  for (const line of written) console.log(`  ${line}`);
}

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
