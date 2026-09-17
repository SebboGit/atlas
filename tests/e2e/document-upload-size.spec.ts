import { expect, test } from './fixtures/auth';
import { seedTrip } from './fixtures/db';

// Uploads cross TWO body caps, and only one of them was configured:
// `experimental.serverActions.bodySizeLimit` (Server Action payload) and
// `experimental.proxyClientMaxBodySize` (the buffered body of any request
// that passes through src/proxy.ts). The second one defaults to 10 MB and
// TRUNCATES rather than rejecting, so a 12 MB PDF reached the action as a
// broken multipart and surfaced as "Something went wrong." — well under
// the 20 MB storage ceiling the UI advertises.
//
// The file is built here rather than committed: a 12 MB fixture has no
// place in the repo.
// Needs STORAGE_MAX_BYTES (default 20 MB) to be at least this much, or
// the upload legitimately fails with "File is too large."
const TWELVE_MB = 12 * 1024 * 1024;

/**
 * A valid single-page PDF padded to `size` bytes. The padding rides in a
 * comment before the trailer, so the magic bytes, object table and EOF
 * marker all stay intact for the `file-type` sniff on upload.
 */
function paddedPdf(size: number): Buffer {
  const head = Buffer.from(
    '%PDF-1.4\n' +
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n',
    'latin1',
  );
  const tail = Buffer.from(
    'trailer<</Root 1 0 R/Size 4>>\n' + 'startxref\n0\n' + '%%EOF\n',
    'latin1',
  );
  // 2 framing bytes: the '%' that opens the comment and its closing newline.
  const padding = Buffer.alloc(Math.max(0, size - head.length - tail.length - 2), 0x20);
  return Buffer.concat([
    head,
    Buffer.from('%', 'latin1'),
    padding,
    Buffer.from('\n', 'latin1'),
    tail,
  ]);
}

test('a 12 MB document uploads instead of failing on the proxy body cap', async ({
  authedPage,
  authedUser,
}) => {
  // A cold route compile, a 16 MB CDP transfer and a 12 MB hashed write
  // don't fit the default 60s budget with any margin.
  test.slow();

  const tripId = await seedTrip(authedUser.id, {
    title: `Upload size probe ${Date.now()}`,
    startDate: new Date('2025-11-02T00:00:00Z'),
    endDate: new Date('2025-11-09T00:00:00Z'),
    status: 'completed',
  });

  await authedPage.goto(`/trips/${tripId}/documents`);
  // The trip chrome's laptop row, the tab header and the empty state each
  // render one; filter to the visible ones so a narrow viewport can't pick
  // a hidden trigger and hang.
  await authedPage
    .getByRole('button', { name: '+ Upload' })
    .filter({ visible: true })
    .first()
    .click();

  const name = `big-reservation-${Date.now()}.pdf`;
  await authedPage.locator('#doc-file').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: paddedPdf(TWELVE_MB),
  });
  // The dialog echoes the picked file's size before submit — proof the
  // browser really attached 12 MB, so a later failure is server-side.
  await expect(authedPage.getByText('12.0 MB', { exact: false }).first()).toBeVisible();

  await authedPage.getByRole('button', { name: 'Upload', exact: true }).click();

  // Pre-fix the truncated body threw past the dialog into the route's error
  // boundary, so the card never appeared. The size line is the assertion
  // that separates "stored whole" from "merely didn't crash": it renders
  // documents.bytes straight from the stored row.
  await expect(authedPage.getByRole('dialog', { name: 'A new document.' })).toBeHidden({
    timeout: 30_000,
  });
  await expect(authedPage.getByText(name).first()).toBeVisible();
  await expect(authedPage.getByText(/PDF · 12\.0 MB/).first()).toBeVisible();
});
