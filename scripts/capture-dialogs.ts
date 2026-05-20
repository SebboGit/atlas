// Standalone dialog capture. Run after fixture + capture-screenshots
// when the bottom-half (modal screenshots) needs a retry.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

interface FixturePayload {
  sessionToken: string;
  trips: Array<{ id: string; title: string; status: string }>;
}

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = path.resolve('tmp/screenshots');
const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 740 },
  { name: 'laptop', width: 1440, height: 900 },
] as const;

async function main() {
  const fixture: FixturePayload = JSON.parse(await readFile('tmp/fixture.json', 'utf8'));
  const detail = fixture.trips[0];
  if (!detail) throw new Error('fixture has no trips');

  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      // bypassCSP: next dev uses eval-based source maps, our prod CSP
      // forbids 'unsafe-eval', which stops client interactivity in dev.
      // Production builds don't need this.
      const ctx = await browser.newContext({ deviceScaleFactor: 2, bypassCSP: true });
      await ctx.addCookies([
        {
          name: 'authjs.session-token',
          value: fixture.sessionToken,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ]);
      const page = await ctx.newPage();
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // --- New-trip dialog ---
      await page.goto(`${BASE}/trips`, { waitUntil: 'load' });
      const trigger = page.getByRole('button', { name: /^new trip$/i }).first();
      await trigger.waitFor({ state: 'visible' });
      // Belt-and-braces wait for hydration: the React event handlers
      // attach after the script chunk loads. Polling for an attached
      // pointer listener is brittle; an explicit 800ms beat is enough.
      await page.waitForTimeout(800);
      await trigger.click();
      await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(500);
      const dialogFile = path.join(OUT_DIR, `${vp.name}-trip-dialog.png`);
      await page.screenshot({ path: dialogFile, fullPage: false });
      process.stdout.write(`✓ ${dialogFile}\n`);

      // --- Delete-forever dialog on detail page ---
      await page.goto(`${BASE}/trips/${detail.id}`, { waitUntil: 'load' });
      const deleteBtn = page.getByRole('button', { name: /delete forever/i }).first();
      await deleteBtn.waitFor({ state: 'visible' });
      await page.waitForTimeout(800);
      await deleteBtn.click();
      await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(500);
      const deleteFile = path.join(OUT_DIR, `${vp.name}-delete-dialog.png`);
      await page.screenshot({ path: deleteFile, fullPage: false });
      process.stdout.write(`✓ ${deleteFile}\n`);

      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
