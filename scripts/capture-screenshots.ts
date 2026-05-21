// Drives a headless Chromium against the running dev server and captures
// the six documentation screenshots into tmp/screenshots/. Pair it with
// scripts/screenshot-fixture.ts, which seeds the synthetic demo data and
// prints the session metadata this script reads from stdin:
//
//   pnpm tsx scripts/screenshot-fixture.ts > /tmp/atlas-fixture.json
//   pnpm tsx scripts/capture-screenshots.ts < /tmp/atlas-fixture.json
//
// (with `pnpm dev` already running). The six PNGs are reviewed, then
// copied into docs/screenshots/ — see docs/screenshots/README.md.
//
// All captures run at the 1440x900 laptop anchor from CLAUDE.md's
// responsive-design rules, at deviceScaleFactor 2 for crisp output.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';

interface FixturePayload {
  sessionToken: string;
  userId: string;
  /** The rich "hero" trip used for the detail / documents / map shots. */
  detailTripId: string;
  trips: Array<{ id: string; title: string; status: string }>;
}

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = path.resolve('tmp/screenshots');
const VIEWPORT = { width: 1440, height: 900 };

// Dev-only chrome that must never appear in documentation screenshots:
// the Next.js dev indicator (rendered into a <nextjs-portal> host) and
// the TanStack Query devtools button (all classes are `tsqd`-prefixed,
// gated to NODE_ENV=development in src/components/providers.tsx).
const HIDE_DEV_OVERLAYS = `
  nextjs-portal,
  [class*='tsqd'] { display: none !important; }
`;

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function openPage(browser: Browser, sessionToken: string): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  await ctx.addCookies([
    {
      name: 'authjs.session-token',
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
  ]);
  return ctx.newPage();
}

async function goto(page: Page, urlPath: string): Promise<void> {
  const resp = await page.goto(`${BASE}${urlPath}`, {
    waitUntil: 'networkidle',
    timeout: 45_000,
  });
  if (!resp || resp.status() >= 400) {
    throw new Error(`bad status ${resp?.status()} for ${urlPath}`);
  }
  await page.addStyleTag({ content: HIDE_DEV_OVERLAYS });
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  process.stdout.write(`  ✓ ${name}.png\n`);
}

// Wait for a MapLibre canvas to be present and given a beat to fetch
// PMTiles range requests + the country GeoJSON. The basemap reads from
// a local 33 GB file, so a few seconds is plenty.
async function settleMap(page: Page, ms = 3500): Promise<void> {
  await page.waitForSelector('canvas', { state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(ms);
}

async function main() {
  const raw = await readStdin();
  const fixture: FixturePayload = JSON.parse(raw);
  if (!fixture.sessionToken) throw new Error('missing sessionToken in fixture stdin');
  if (!fixture.detailTripId) throw new Error('missing detailTripId in fixture stdin');

  await mkdir(OUT_DIR, { recursive: true });
  const hero = fixture.detailTripId;

  const browser = await chromium.launch();
  try {
    const page = await openPage(browser, fixture.sessionToken);

    // --- Trips overview ---------------------------------------------------
    process.stdout.write('▸ trips overview\n');
    await goto(page, '/trips');
    await page.waitForTimeout(900); // entrance animations
    await shoot(page, 'trips-overview');

    // --- Trip detail (itinerary) -----------------------------------------
    process.stdout.write('▸ trip detail\n');
    await goto(page, `/trips/${hero}/itinerary`);
    await page.waitForTimeout(900);
    await shoot(page, 'trip-detail');

    // --- Documents tab ----------------------------------------------------
    process.stdout.write('▸ documents\n');
    await goto(page, `/trips/${hero}/documents`);
    await page.waitForTimeout(900);
    await shoot(page, 'documents');

    // --- World map --------------------------------------------------------
    process.stdout.write('▸ world map\n');
    await goto(page, '/map');
    await settleMap(page);
    await shoot(page, 'world-map');

    // --- Trip map (full extent) ------------------------------------------
    process.stdout.write('▸ trip map\n');
    await goto(page, `/trips/${hero}/map`);
    await page.waitForSelector('.maplibregl-marker', { timeout: 30_000 });
    await settleMap(page);
    await shoot(page, 'trip-map');

    // --- Trip map, zoomed onto a hotel pin -------------------------------
    // dispatchEvent bypasses pointer hit-testing: at the full trip
    // extent the Tokyo hotel pin sits under an overlapping flight pin,
    // which blocks a real click. The synthetic click still bubbles to
    // the marker's handler, which opens the hover tooltip and flyTo's
    // to PIN_CLICK_ZOOM (12). No real cursor interaction means nothing
    // fires `mouseleave` afterwards, so the tooltip stays open.
    process.stdout.write('▸ trip map (zoom)\n');
    await goto(page, `/trips/${hero}/map`);
    await page.waitForSelector('.maplibregl-marker', { timeout: 30_000 });
    await settleMap(page);

    const hotelPin = page.locator('svg.lucide-bed').first();
    await hotelPin.dispatchEvent('click');
    await page.waitForTimeout(3800); // flyTo (800ms) + Z12 tile fetch
    await shoot(page, 'trip-map-zoom');

    await page.context().close();
  } finally {
    await browser.close();
  }

  process.stdout.write(`\n✓ 6 screenshots in ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
