// One-shot: regenerate the PWA home-screen icons from public/atlas_logo.svg.
//
// The generated PNGs are committed (they're the runtime source of truth for
// the web manifest + Apple touch icon); this script just makes them
// reproducible. Re-run it whenever the logo changes:
//
//   pnpm tsx scripts/generate-pwa-icons.ts
//
// We render the (transparent) logo onto a solid cream square so the icon
// reads as a badge rather than a floating circle. "maskable" variants leave
// extra padding so a launcher's circular/squircle crop can't clip the logo
// (the maskable safe zone is the inner ~80%).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'public', 'atlas_logo.svg');

// Matches --color-background / the layout themeColor (#e8dec7).
const CREAM = { r: 0xe8, g: 0xde, b: 0xc7, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const ICONS = [
  { file: 'icons/icon-192.png', size: 192, scale: 1 },
  { file: 'icons/icon-512.png', size: 512, scale: 1 },
  { file: 'icons/icon-maskable-192.png', size: 192, scale: 0.7 },
  { file: 'icons/icon-maskable-512.png', size: 512, scale: 0.7 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
] as const;

async function render(svg: Buffer, size: number, scale: number): Promise<Buffer> {
  const inner = Math.round(size * scale);
  const logo = await sharp(svg)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 4, background: CREAM } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  const svg = await readFile(SOURCE);
  await mkdir(path.join(ROOT, 'public', 'icons'), { recursive: true });

  for (const { file, size, scale } of ICONS) {
    const png = await render(svg, size, scale);
    await writeFile(path.join(ROOT, 'public', file), png);
    console.log(`wrote public/${file} (${size}×${size})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
