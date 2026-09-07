/** The known-answer document corpus.
 *
 * Every file here is generated from these declarations, so the expected answer is known before
 * the reader runs: the cancellation window in the PDF is 24 hours because this file says so,
 * the workbook totals 150,250 centavos because 1,500 rows of 100 plus one row of 250 is what
 * is written, and the hidden sheet is hidden because it is declared hidden.
 *
 * Synthetic throughout. No client content, no licensed assets.
 */
import { buildDocx, buildPptx, buildXlsx, type SheetCell } from '../../packages/documents/src/ooxml.js';
import { buildPdf } from '../../packages/documents/src/pdf.js';
import { buildPng } from '../../packages/documents/src/image.js';
import { writeZip } from '../../packages/documents/src/zip.js';

/** The contract the corpus encodes, and the answers a reader must arrive at. */
export const KNOWN_ANSWERS = {
  pdf_cancellation_hours: 24,
  docx_cancellation_hours: 48,
  pptx_notes_cancellation_hours: 48,
  workbook_total_centavos: 150_250,
  workbook_rows: 1501,
  workbook_late_row_value_centavos: 250,
  hidden_adjustment_centavos: -5_000,
  workbook_total_with_adjustment_centavos: 145_250,
  customer_id_with_leading_zero: '00742',
} as const;

/** A three-page PDF: two pages with a text layer, one scanned page with none. */
export function pdfTerms(): Buffer {
  return buildPdf([
    { lines: [
      'ACME Delivery — Terms of Service',
      'Version 3. Effective 1 September 2026.',
      'Orders are confirmed when payment is received.',
    ], scanned: false },
    { lines: [
      'Cancellation',
      `A booking may be cancelled within ${String(KNOWN_ANSWERS.pdf_cancellation_hours)} hours of confirmation.`,
      'After that window the deposit is retained.',
      'Refunds are processed within five working days.',
    ], scanned: false },
    { lines: [], scanned: true },
  ]);
}

/** A DOCX whose cancellation rule contradicts the PDF, with the parts a review must inventory. */
export function docxPolicy(): Buffer {
  return buildDocx({
    blocks: [
      { kind: 'heading', level: 1, text: 'Operations Manual' },
      { kind: 'paragraph', text: 'This manual governs day-to-day handling of bookings.' },
      { kind: 'heading', level: 2, text: 'Cancellation' },
      { kind: 'paragraph', text: `Staff may cancel a booking within ${String(KNOWN_ANSWERS.docx_cancellation_hours)} hours of confirmation.` },
      { kind: 'table', rows: [['Item', 'Unit price (centavos)'], ['Rice, 1kg', '4500'], ['Soap, bar', '2500']] },
      { kind: 'paragraph', text: 'Escalate any dispute to the operations lead.' },
    ],
    header: 'ACME Delivery — internal',
    footer: 'Operations Manual, page 1',
    footnotes: ['Prices exclude delivery and are reviewed quarterly.'],
    comments: [{ author: 'Legal', text: 'Confirm this matches the published terms.' }],
    revisions: [{ author: 'Operations', inserted: ' Confirmed by operations.' }],
    macro_part: false, remote_template: null,
  });
}

/** The workbook: 1,500 rows at 100 centavos, row 1,501 at 250, a hidden adjustment sheet, a
 * cached total that is deliberately stale, an unsupported function and a blocked external link. */
export function xlsxPricing(options: { stale_cached_total?: boolean } = {}): Buffer {
  const cells: SheetCell[] = [
    { ref: 'A1', value: 'line', text: true },
    { ref: 'B1', value: 100 },
    { ref: 'C1', value: KNOWN_ANSWERS.customer_id_with_leading_zero, text: true },
  ];
  for (let row = 2; row <= 1500; row += 1) cells.push({ ref: `B${row}`, value: 100 });
  cells.push({ ref: `B${KNOWN_ANSWERS.workbook_rows}`, value: KNOWN_ANSWERS.workbook_late_row_value_centavos });
  cells.push({ ref: 'E1', formula: 'SUM(B1:B1501)', cached: options.stale_cached_total === false ? '150250' : '150000' });
  cells.push({ ref: 'E2', formula: "'Adjustments'!B1", cached: '-5000' });
  cells.push({ ref: 'E3', formula: 'E1+E2', cached: '145000' });
  cells.push({ ref: 'E4', formula: 'XLOOKUP(A1,B:B,C:C)', cached: '#N/A' });
  cells.push({ ref: 'E5', formula: "'[external.xlsx]Sheet1'!A1", cached: '0' });
  return buildXlsx({
    sheets: [
      { name: 'Items', hidden: false, cells },
      { name: 'Adjustments', hidden: true, cells: [
        { ref: 'A1', value: 'bulk discount', text: true },
        { ref: 'B1', value: KNOWN_ANSWERS.hidden_adjustment_centavos },
      ] },
    ],
    named_ranges: [{ name: 'GrandTotal', refers_to: 'Items!$E$3' }],
    external_links: ['https://example.invalid/external.xlsx'],
  });
}

/** A deck whose notes carry the third statement of the cancellation rule, plus a real chart. */
export function pptxDeck(): Buffer {
  return buildPptx({
    slides: [
      { shapes: [
        { shape_id: '2', kind: 'text', text: 'Q3 pricing review' },
        { shape_id: '3', kind: 'chart', text: 'Revenue by month' },
      ], notes: `Legal reminded us the cancellation window is ${String(KNOWN_ANSWERS.pptx_notes_cancellation_hours)} hours.` },
      { shapes: [
        { shape_id: '4', kind: 'text', text: 'Next steps' },
        { shape_id: '5', kind: 'unsupported', text: 'Embedded OLE object' },
      ], notes: null },
    ],
  });
}

/** CSV with the things that go wrong: a leading-zero identifier, a quoted multiline field, and
 * a formula-injection canary that must travel as literal text. */
export const CSV_INJECTION_CANARY = '=cmd|\' /C calc\'!A1';
export function csvOrders(): Buffer {
  return Buffer.from([
    'order_id,customer_id,note,amount_centavos',
    `1001,${KNOWN_ANSWERS.customer_id_with_leading_zero},"first line\nsecond line",4500`,
    `1002,00815,"${CSV_INJECTION_CANARY}",2500`,
    '',
  ].join('\n'), 'utf8');
}

export function tsvOrders(): Buffer {
  return Buffer.from(`order_id\tcustomer_id\tamount_centavos\n1001\t${KNOWN_ANSWERS.customer_id_with_leading_zero}\t4500\n`, 'utf8');
}

/** An image with dark marks standing in for small text that a reader cannot resolve. */
export function pngScreenshot(): Buffer {
  return buildPng({ width: 320, height: 200, marks: [{ x: 20, y: 30, width: 180, height: 10 }, { x: 20, y: 60, width: 120, height: 8 }] });
}

export function markdownBrief(): Buffer {
  return Buffer.from('# Brief\n\nSummarise the cancellation rules across the three documents.\n', 'utf8');
}

export function jsonConfig(): Buffer {
  return Buffer.from(JSON.stringify({ currency: 'PHP', minor_units: 100 }, null, 2) + '\n', 'utf8');
}

/** ------------------------------------------------------------------ canaries */

/** A DOCX carrying a macro part and a remote template. Both must be found and neither run. */
export function docxWithMacroAndRemoteTemplate(): Buffer {
  return buildDocx({
    blocks: [{ kind: 'paragraph', text: 'Ordinary looking document.' }],
    header: null, footer: null, footnotes: [], comments: [], revisions: [],
    macro_part: true, remote_template: 'https://example.invalid/tracking-template.dotm',
  });
}

/** A container whose members expand far beyond their compressed size. */
export function zipBomb(): Buffer {
  const payload = Buffer.alloc(4 * 1024 * 1024, 0x41);
  return writeZip([
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types/>', 'utf8') },
    { name: 'word/document.xml', bytes: payload },
  ]);
}

/** A container with a member that would escape the extraction root. */
export function zipTraversal(): Buffer {
  return writeZip([
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types/>', 'utf8') },
    { name: 'word/document.xml', bytes: Buffer.from('<w:document/>', 'utf8') },
    { name: '../../etc/passwd', bytes: Buffer.from('root:x:0:0', 'utf8') },
  ]);
}

/** A container with an absolute path member. */
export function zipAbsolutePath(): Buffer {
  return writeZip([
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types/>', 'utf8') },
    { name: 'word/document.xml', bytes: Buffer.from('<w:document/>', 'utf8') },
    { name: '/etc/hosts', bytes: Buffer.from('127.0.0.1 localhost', 'utf8') },
  ]);
}

/** A container holding thousands of members. */
export function zipManyMembers(count = 2500): Buffer {
  return writeZip([
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types/>', 'utf8') },
    ...Array.from({ length: count }, (_, index) => ({ name: `word/part${index}.xml`, bytes: Buffer.from('<p/>', 'utf8') })),
  ]);
}

/** A PDF that will be offered as a DOCX: the bytes decide, not the declaration. */
export function forgedType(): Buffer {
  return pdfTerms();
}

/** An OLE compound file, which is what a legacy .doc is. It is not an OOXML document. */
export function legacyOle(): Buffer {
  return Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512, 0)]);
}

export const MEDIA_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  png: 'image/png',
  markdown: 'text/markdown',
  json: 'application/json',
  text: 'text/plain',
} as const;

/** The published API documentation for the disposable pricing service. The parameter name in
 * it is wrong, and only executing the example finds that out. */
export const API_DOCUMENTATION = `# Pricing API

## GET /price

Returns the total for a product and a quantity.

| Parameter | Description |
|---|---|
| product | The product identifier. |
| qty | How many units. |

Example:

    GET /price?product=rice&qty=2

Returns \`{"product":"rice","quantity":2,"total_centavos":9000}\`.
`;
