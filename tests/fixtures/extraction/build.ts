// Regenerates the test fixtures for the OCR + extraction modules.
//
// Usage:
//   pnpm tsx tests/fixtures/extraction/build.ts
//
// Outputs (all committed to git so tests are deterministic):
//   - text-pdf.pdf        — a tiny PDF with a real text layer
//   - image-only.pdf      — a PDF whose only page contains a PNG, no text
//   - boarding-image.png  — a PNG with the word "BOARDING" used by the
//                           Tesseract test (only when RUN_TESSERACT_TESTS=1)
//   - boarding.pkpass     — a minimal Apple Wallet pass with a
//                           boardingPass block, used by the pkpass
//                           extractor tests
//   - coupon.pkpass       — a pkpass WITHOUT a boardingPass block
//                           (used to assert that non-flight passes are
//                           skipped, not falsely classified)
//   - multipart.eml       — a multipart/alternative email carrying
//                           both text/plain and text/html — used to
//                           assert text/plain wins
//   - html-only.eml       — an HTML-only email so the HTML-strip
//                           fallback gets exercised
//   - malformed.eml       — bytes that look like text but aren't a
//                           valid MIME message — must return null
//
// Why a script? "Hand-crafted PDF bytes nobody can regenerate" is a
// liability when pdfjs changes its parser or when we want to add
// another fixture. pdf-lib gives us a 30-line deterministic generator
// and keeps the binary blobs reviewable.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync, strToU8 } from 'fflate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A 1×1 PNG used to embed *something* in the image-only PDF. We don't
// need a real picture here — just bytes that pdf-lib accepts as a PNG.
// Generated once via base64 so the fixture script has zero runtime
// image-encoding dependencies for the PDFs themselves.
function makeTinyPng(): Uint8Array {
  // 1×1 transparent PNG (smallest valid PNG, ~67 bytes).
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

async function buildTextPdf(outPath: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('Atlas OCR fixture — extractable text layer.', {
    x: 30,
    y: 240,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText('Boarding pass: BA287 LHR -> SFO 2026-06-01.', {
    x: 30,
    y: 200,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText('Passenger: DOE/JANE. Seat: 12A. Gate: 42.', {
    x: 30,
    y: 160,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });
  const pdfBytes = await doc.save({ useObjectStreams: false });
  await writeFile(outPath, pdfBytes);
  console.log(`[fixtures] wrote ${path.basename(outPath)} (${pdfBytes.byteLength} bytes)`);
}

async function buildImageOnlyPdf(outPath: string): Promise<void> {
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(makeTinyPng());
  const page = doc.addPage([400, 300]);
  // Stretch the 1×1 image to fill most of the page. There is no text
  // layer on the page at all — this is the "scanned image" case.
  page.drawImage(png, { x: 20, y: 20, width: 360, height: 260 });
  const pdfBytes = await doc.save({ useObjectStreams: false });
  await writeFile(outPath, pdfBytes);
  console.log(`[fixtures] wrote ${path.basename(outPath)} (${pdfBytes.byteLength} bytes)`);
}

async function buildBoardingPng(outPath: string): Promise<void> {
  // Black text on a white background, large enough that Tesseract
  // finds it without any preprocessing. We render several lines so
  // the recognised output comfortably clears MIN_USEFUL_CHARS (32);
  // a single 8-character "BOARDING" word would not.
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="320">
      <rect width="100%" height="100%" fill="white"/>
      <text x="40" y="90" font-family="Helvetica, Arial, sans-serif"
            font-size="64" font-weight="700" fill="black">BOARDING PASS</text>
      <text x="40" y="170" font-family="Helvetica, Arial, sans-serif"
            font-size="48" fill="black">FLIGHT BA287 LHR SFO</text>
      <text x="40" y="240" font-family="Helvetica, Arial, sans-serif"
            font-size="48" fill="black">PASSENGER JANE DOE</text>
    </svg>`,
  );

  await sharp(svg).png().toFile(outPath);
  console.log(`[fixtures] wrote ${path.basename(outPath)} via sharp`);
}

async function buildBoardingPkpass(outPath: string): Promise<void> {
  // Minimal pass.json with a boardingPass block. Field keys / labels
  // chosen to match the keyword sets in src/lib/extraction/pkpass.ts.
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: 'pass.com.example.boarding',
    serialNumber: 'PNR-ABC123',
    teamIdentifier: 'TEAMID',
    organizationName: 'British Airways',
    description: 'Boarding Pass',
    relevantDate: '2026-06-01T11:30:00Z',
    boardingPass: {
      transitType: 'PKTransitTypeAir',
      headerFields: [{ key: 'flightNumber', label: 'Flight', value: 'BA287' }],
      primaryFields: [
        { key: 'origin', label: 'From', value: 'LHR' },
        { key: 'destination', label: 'To', value: 'SFO' },
      ],
      secondaryFields: [
        { key: 'passenger', label: 'Passenger', value: 'DOE/JANE' },
        { key: 'date', label: 'Date', value: '2026-06-01' },
      ],
    },
  };

  const zipped = zipSync({
    'pass.json': strToU8(JSON.stringify(pass)),
  });
  await writeFile(outPath, zipped);
  console.log(`[fixtures] wrote ${path.basename(outPath)} (${zipped.byteLength} bytes)`);
}

async function buildCouponPkpass(outPath: string): Promise<void> {
  // A pkpass for a coupon — no boardingPass block. The extractor must
  // skip these without falsely classifying them as boarding passes.
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: 'pass.com.example.coupon',
    serialNumber: 'CPN-123',
    teamIdentifier: 'TEAMID',
    organizationName: 'Acme Coffee',
    description: 'Coupon',
    coupon: {
      primaryFields: [{ key: 'discount', label: 'Off', value: '10%' }],
    },
  };
  const zipped = zipSync({ 'pass.json': strToU8(JSON.stringify(pass)) });
  await writeFile(outPath, zipped);
  console.log(`[fixtures] wrote ${path.basename(outPath)} (${zipped.byteLength} bytes)`);
}

async function buildMultipartEml(outPath: string): Promise<void> {
  // multipart/alternative with both text/plain and text/html. Each part
  // contains a deliberately distinct marker so the test can prove which
  // one the extractor picked.
  const eml = [
    'From: noreply@booking.example',
    'To: traveler@example.org',
    'Subject: Your hotel reservation is confirmed',
    'Date: Mon, 01 Jun 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="boundary42"',
    '',
    '--boundary42',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    'PLAIN-MARKER: Booking confirmed at Hotel California.',
    'Check-in: 2026-06-01',
    'Check-out: 2026-06-05',
    'Confirmation: CONF-9',
    'Address: 1 Sunset Blvd, Los Angeles, CA',
    '',
    '--boundary42',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    '<html><head><style>body{font-family:Arial}</style></head>',
    '<body><h1>HTML-MARKER</h1><p>Hotel California — confirmed.</p></body></html>',
    '',
    '--boundary42--',
    '',
  ].join('\r\n');
  await writeFile(outPath, eml, 'utf8');
  console.log(`[fixtures] wrote ${path.basename(outPath)} (${Buffer.byteLength(eml)} bytes)`);
}

async function buildHtmlOnlyEml(outPath: string): Promise<void> {
  // HTML-only email with a chunky <style> block, an Outlook-conditional
  // comment, an HTML entity, and table scaffolding — the stuff that
  // bloats raw HTML and that our stripHtml must remove. The useful
  // content survives.
  const eml = [
    'From: confirmations@airline.example',
    'To: traveler@example.org',
    'Subject: Boarding pass — BA287',
    'Date: Mon, 01 Jun 2026 10:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    '<!DOCTYPE html><html><head>',
    '<style>body{font-family:Arial;color:#333;}.hidden{display:none}</style>',
    '<!--[if mso]><style>.outlook{}</style><![endif]-->',
    '</head><body>',
    '<table><tr><td><h1>Your boarding pass</h1></td></tr>',
    '<tr><td>Flight: BA287</td></tr>',
    '<tr><td>From: London Heathrow (LHR) &rarr; San Francisco (SFO)</td></tr>',
    '<tr><td>Date: 2026-06-01</td></tr>',
    '<tr><td>Passenger: Jane Doe</td></tr></table>',
    '<script>tracking()</script>',
    '</body></html>',
    '',
  ].join('\r\n');
  await writeFile(outPath, eml, 'utf8');
  console.log(`[fixtures] wrote ${path.basename(outPath)} (${Buffer.byteLength(eml)} bytes)`);
}

async function buildMalformedEml(outPath: string): Promise<void> {
  const eml = 'this is not a MIME message — just freeform text\nwith a newline\n';
  await writeFile(outPath, eml, 'utf8');
  console.log(`[fixtures] wrote ${path.basename(outPath)} (${Buffer.byteLength(eml)} bytes)`);
}

async function main(): Promise<void> {
  await buildTextPdf(path.join(__dirname, 'text-pdf.pdf'));
  await buildImageOnlyPdf(path.join(__dirname, 'image-only.pdf'));
  await buildBoardingPng(path.join(__dirname, 'boarding-image.png'));
  await buildBoardingPkpass(path.join(__dirname, 'boarding.pkpass'));
  await buildCouponPkpass(path.join(__dirname, 'coupon.pkpass'));
  await buildMultipartEml(path.join(__dirname, 'multipart.eml'));
  await buildHtmlOnlyEml(path.join(__dirname, 'html-only.eml'));
  await buildMalformedEml(path.join(__dirname, 'malformed.eml'));
}

main().catch((err: unknown) => {
  console.error('[fixtures] failed:', err);
  process.exitCode = 1;
});
