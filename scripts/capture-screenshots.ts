// Drives a headless Chromium against the running dev server, captures
// the Trips surfaces at two viewports (360x640 phone, 1440x900 laptop),
// and writes PNGs to tmp/screenshots/. Reads the fixture metadata
// (sessionToken + trip ids) from stdin so it can deep-link to detail.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext } from 'playwright';

interface FixturePayload {
  sessionToken: string;
  userId: string;
  trips: Array<{ id: string; title: string; status: string }>;
}

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = path.resolve('tmp/screenshots');

const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'laptop', width: 1440, height: 900 },
] as const;

type View = { slug: string; path: string };

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function withCookieContext(browser: Browser, sessionToken: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    deviceScaleFactor: 2, // crisper screenshots on retina-style assets
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
  return ctx;
}

async function main() {
  const raw = await readStdin();
  const fixture: FixturePayload = JSON.parse(raw);
  if (!fixture.sessionToken) throw new Error('missing sessionToken in fixture stdin');

  await mkdir(OUT_DIR, { recursive: true });

  const detail = fixture.trips[0];
  if (!detail) throw new Error('fixture has no trips');

  const views: View[] = [
    { slug: 'home', path: '/' },
    { slug: 'trips-list', path: '/trips' },
    { slug: 'trips-detail', path: `/trips/${detail.id}` },
    { slug: 'trips-archived', path: '/trips?status=archived' },
  ];

  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await withCookieContext(browser, fixture.sessionToken);
      const page = await ctx.newPage();
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const view of views) {
        const url = `${BASE}${view.path}`;
        process.stdout.write(`▸ ${vp.name} ${vp.width}x${vp.height}  ${view.path}\n`);
        const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
        if (!resp || resp.status() >= 400) {
          throw new Error(`bad status ${resp?.status()} for ${url}`);
        }
        // Let entrance animations settle.
        await page.waitForTimeout(900);

        const file = path.join(OUT_DIR, `${vp.name}-${view.slug}.png`);
        await page.screenshot({ path: file, fullPage: true });
      }
      await ctx.close();
    }

    // Capture the create-trip dialog open, at both viewports. The
    // dialog renders very differently between bottom-sheet and centered
    // card, so we want to see both.
    for (const vp of VIEWPORTS) {
      const ctx = await withCookieContext(browser, fixture.sessionToken);
      const page = await ctx.newPage();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle' });
      await page
        .getByRole('button', { name: /new trip/i })
        .first()
        .click();
      await page.waitForSelector('[role="dialog"]', { state: 'visible' });
      await page.waitForTimeout(500);
      const file = path.join(OUT_DIR, `${vp.name}-trip-dialog.png`);
      await page.screenshot({ path: file, fullPage: false });
      process.stdout.write(`▸ ${vp.name} dialog → ${file}\n`);
      await ctx.close();
    }

    // And the destructive-delete dialog on the detail page.
    for (const vp of VIEWPORTS) {
      const ctx = await withCookieContext(browser, fixture.sessionToken);
      const page = await ctx.newPage();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/trips/${detail.id}`, { waitUntil: 'networkidle' });
      await page
        .getByRole('button', { name: /delete forever/i })
        .first()
        .click();
      await page.waitForSelector('[role="dialog"]', { state: 'visible' });
      await page.waitForTimeout(500);
      const file = path.join(OUT_DIR, `${vp.name}-delete-dialog.png`);
      await page.screenshot({ path: file, fullPage: false });
      process.stdout.write(`▸ ${vp.name} delete dialog → ${file}\n`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(`\n✓ Screenshots in ${OUT_DIR}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
