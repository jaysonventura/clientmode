/** OOXML documents: build the fixtures, and read them back structurally.
 *
 * DOCX, XLSX and PPTX are ZIP containers of XML parts. Reading them structurally is what an
 * inventory needs — every sheet including the hidden ones, every row including the ones past
 * the thousandth, the formula next to its cached value, the comment, the footnote, the chart.
 * A reader that hands back "the text" has already dropped exactly the things that matter.
 *
 * The XML here is minimal but real: the parts, relationships and content types Office needs,
 * written deterministically so a digest means something.
 */
import { inspectContainer, readMember, writeZip, type ZipEntry } from './zip.js';

export class OoxmlError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'OoxmlError';
  }
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** ---------------------------------------------------------------- DOCX */

export type DocxBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; rows: string[][] };

export type DocxSource = {
  blocks: DocxBlock[];
  header: string | null;
  footer: string | null;
  footnotes: string[];
  comments: Array<{ author: string; text: string }>;
  /** A recorded revision (tracked change) in the body. */
  revisions: Array<{ author: string; inserted: string }>;
  /** Set to include a macro part, which is what a .docm carries and a .docx must not. */
  macro_part: boolean;
  /** Set to reference an external template, which must not be fetched. */
  remote_template: string | null;
};

export function buildDocx(source: DocxSource): Buffer {
  const body = source.blocks.map(block => {
    if (block.kind === 'heading') {
      return `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r></w:p>`;
    }
    if (block.kind === 'paragraph') {
      return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r></w:p>`;
    }
    const rows = block.rows.map(row =>
      `<w:tr>${row.map(cell => `<w:tc><w:p><w:r><w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('');
    return `<w:tbl>${rows}</w:tbl>`;
  }).join('');
  const revisions = source.revisions.map((revision, index) =>
    `<w:ins w:id="${index + 1}" w:author="${escapeXml(revision.author)}" w:date="2026-09-09T00:00:00Z"><w:r><w:t xml:space="preserve">${escapeXml(revision.inserted)}</w:t></w:r></w:ins>`).join('');
  const footnoteRefs = source.footnotes.map((_, index) =>
    `<w:p><w:r><w:footnoteReference w:id="${index + 2}"/></w:r></w:p>`).join('');

  const entries: ZipEntry[] = [];
  const parts: Array<[string, string]> = [];
  const add = (name: string, xml: string): void => { entries.push({ name, bytes: Buffer.from(XML_HEADER + xml, 'utf8') }); parts.push([name, xml]); };

  add('word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${revisions}${footnoteRefs}<w:sectPr><w:headerReference w:type="default" r:id="rId10" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></w:sectPr></w:body></w:document>`);
  if (source.header !== null) {
    add('word/header1.xml', `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t xml:space="preserve">${escapeXml(source.header)}</w:t></w:r></w:p></w:hdr>`);
  }
  if (source.footer !== null) {
    add('word/footer1.xml', `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t xml:space="preserve">${escapeXml(source.footer)}</w:t></w:r></w:p></w:ftr>`);
  }
  if (source.footnotes.length > 0) {
    add('word/footnotes.xml', `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${
      source.footnotes.map((text, index) => `<w:footnote w:id="${index + 2}"><w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:footnote>`).join('')}</w:footnotes>`);
  }
  if (source.comments.length > 0) {
    add('word/comments.xml', `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${
      source.comments.map((comment, index) => `<w:comment w:id="${index + 1}" w:author="${escapeXml(comment.author)}"><w:p><w:r><w:t xml:space="preserve">${escapeXml(comment.text)}</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`);
  }
  if (source.macro_part) entries.push({ name: 'word/vbaProject.bin', bytes: Buffer.from('MACRO-CANARY-NOT-EXECUTED', 'utf8') });

  const relationships = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    source.remote_template === null ? ''
      : `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="${escapeXml(source.remote_template)}" TargetMode="External"/>`,
  ].join('');
  entries.unshift({ name: '_rels/.rels', bytes: Buffer.from(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`, 'utf8') });
  entries.unshift({ name: '[Content_Types].xml', bytes: Buffer.from(`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`, 'utf8') });
  return writeZip(entries);
}

export type DocxBlockRead = { part_name: string; block_path: string; kind: DocxBlock['kind'] | 'footnote' | 'comment' | 'revision'; text: string };

export type DocxRead = {
  blocks: DocxBlockRead[];
  parts: string[];
  /** Parts the reader recognises. Anything else is exposed rather than silently ignored. */
  unhandled_parts: string[];
  has_macro_part: boolean;
  external_relationship_targets: string[];
  comment_count: number;
  revision_count: number;
};

const HANDLED = /^(\[Content_Types\]\.xml|_rels\/\.rels|word\/(document|header\d+|footer\d+|footnotes|comments)\.xml)$/;

export function readDocx(bytes: Buffer): DocxRead {
  const parts = namesOf(bytes);
  const blocks: DocxBlockRead[] = [];
  const push = (part_name: string, kind: DocxBlockRead['kind'], index: number, text: string): void => {
    blocks.push({ part_name, block_path: `/${kind}[${index}]`, kind, text });
  };
  const textOf = (fragment: string): string =>
    [...fragment.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => unescapeXml(match[1]!)).join('');

  if (parts.includes('word/document.xml')) {
    const xml = readMember(bytes, 'word/document.xml').toString('utf8');
    const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? '';
    let paragraphIndex = 0;
    for (const match of body.matchAll(/<w:p>([\s\S]*?)<\/w:p>|<w:tbl>([\s\S]*?)<\/w:tbl>|<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g)) {
      paragraphIndex += 1;
      if (match[1] !== undefined) {
        const heading = /<w:pStyle w:val="Heading(\d)"\/>/.exec(match[1]);
        push('word/document.xml', heading === null ? 'paragraph' : 'heading', paragraphIndex, textOf(match[1]));
      } else if (match[2] !== undefined) {
        const rows = [...match[2].matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)]
          .map(row => [...row[1]!.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(cell => textOf(cell[1]!)).join(' | '));
        push('word/document.xml', 'table', paragraphIndex, rows.join('\n'));
      } else if (match[3] !== undefined) {
        push('word/document.xml', 'revision', paragraphIndex, textOf(match[3]));
      }
    }
  }
  for (const [part, kind] of [['word/header1.xml', 'paragraph'], ['word/footer1.xml', 'paragraph'],
    ['word/footnotes.xml', 'footnote'], ['word/comments.xml', 'comment']] as const) {
    if (!parts.includes(part)) continue;
    const xml = readMember(bytes, part).toString('utf8');
    [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].forEach((match, index) => push(part, kind, index + 1, textOf(match[1]!)));
  }
  const rels = parts.includes('_rels/.rels') ? readMember(bytes, '_rels/.rels').toString('utf8') : '';
  return {
    blocks, parts,
    unhandled_parts: parts.filter(part => !HANDLED.test(part)),
    has_macro_part: parts.some(part => /vbaProject\.bin$/i.test(part)),
    external_relationship_targets: [...rels.matchAll(/Target="([^"]+)"\s+TargetMode="External"/g)].map(match => unescapeXml(match[1]!)),
    comment_count: blocks.filter(block => block.kind === 'comment').length,
    revision_count: blocks.filter(block => block.kind === 'revision').length,
  };
}

/** ---------------------------------------------------------------- XLSX */

export type SheetCell = { ref: string; value?: string | number; formula?: string; cached?: string | number; number_format?: string; text?: boolean };
export type SheetSource = { name: string; hidden: boolean; cells: SheetCell[] };
export type XlsxSource = { sheets: SheetSource[]; named_ranges?: Array<{ name: string; refers_to: string }>; external_links?: string[]; chart_sheets?: string[] };

const columnIndex = (ref: string): number => {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A';
  return [...letters].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0);
};
export const rowOf = (ref: string): number => Number(/(\d+)$/.exec(ref)?.[1] ?? '0');

export function buildXlsx(source: XlsxSource): Buffer {
  const entries: ZipEntry[] = [];
  const sheetXml = (sheet: SheetSource): string => {
    const byRow = new Map<number, SheetCell[]>();
    for (const cell of sheet.cells) {
      const row = rowOf(cell.ref);
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row)!.push(cell);
    }
    const rows = [...byRow.entries()].sort(([left], [right]) => left - right).map(([row, cells]) => {
      const rendered = cells.sort((left, right) => columnIndex(left.ref) - columnIndex(right.ref)).map(cell => {
        if (cell.formula !== undefined) {
          const cached = cell.cached === undefined ? '' : `<v>${escapeXml(String(cell.cached))}</v>`;
          return `<c r="${cell.ref}"><f>${escapeXml(cell.formula)}</f>${cached}</c>`;
        }
        if (cell.text === true) return `<c r="${cell.ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell.value ?? ''))}</t></is></c>`;
        return `<c r="${cell.ref}"><v>${escapeXml(String(cell.value ?? ''))}</v></c>`;
      }).join('');
      return `<row r="${row}">${rendered}</row>`;
    }).join('');
    return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  };
  source.sheets.forEach((sheet, index) => {
    entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, bytes: Buffer.from(sheetXml(sheet), 'utf8') });
  });
  const sheetTags = source.sheets.map((sheet, index) =>
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"${sheet.hidden ? ' state="hidden"' : ''}/>`).join('');
  const definedNames = (source.named_ranges ?? []).map(range =>
    `<definedName name="${escapeXml(range.name)}">${escapeXml(range.refers_to)}</definedName>`).join('');
  entries.push({ name: 'xl/workbook.xml', bytes: Buffer.from(
    `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets>${definedNames === '' ? '' : `<definedNames>${definedNames}</definedNames>`}</workbook>`, 'utf8') });
  const relationships = source.sheets.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
    + (source.external_links ?? []).map((target, index) =>
      `<Relationship Id="rIdX${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="${escapeXml(target)}" TargetMode="External"/>`).join('');
  entries.push({ name: 'xl/_rels/workbook.xml.rels', bytes: Buffer.from(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`, 'utf8') });
  entries.unshift({ name: '_rels/.rels', bytes: Buffer.from(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`, 'utf8') });
  entries.unshift({ name: '[Content_Types].xml', bytes: Buffer.from(`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`, 'utf8') });
  return writeZip(entries);
}

export type SheetRead = {
  name: string; hidden: boolean; part_name: string;
  cells: Array<{ ref: string; row: number; value: string | null; formula: string | null; cached: string | null; inline_text: boolean }>;
  row_count: number; max_row: number;
};

export type XlsxRead = {
  sheets: SheetRead[];
  named_ranges: Array<{ name: string; refers_to: string }>;
  external_link_targets: string[];
  parts: string[];
};

export function readXlsx(bytes: Buffer): XlsxRead {
  const parts = namesOf(bytes);
  const workbook = readMember(bytes, 'xl/workbook.xml').toString('utf8');
  const rels = parts.includes('xl/_rels/workbook.xml.rels') ? readMember(bytes, 'xl/_rels/workbook.xml.rels').toString('utf8') : '';
  const sheetTags = [...workbook.matchAll(/<sheet\s([^>]*)\/>/g)].map(match => match[1]!);
  const sheets: SheetRead[] = sheetTags.map((attributes, index) => {
    const name = unescapeXml(/name="([^"]*)"/.exec(attributes)?.[1] ?? `Sheet${index + 1}`);
    const hidden = /state="(hidden|veryHidden)"/.test(attributes);
    const part_name = `xl/worksheets/sheet${index + 1}.xml`;
    const xml = parts.includes(part_name) ? readMember(bytes, part_name).toString('utf8') : '';
    const cells = [...xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)].map(match => {
      const inner = match[3]!;
      const formula = /<f>([\s\S]*?)<\/f>/.exec(inner)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
      return {
        ref: match[1]!, row: rowOf(match[1]!),
        value: inline !== undefined ? unescapeXml(inline) : formula !== undefined ? null : value === undefined ? null : unescapeXml(value),
        formula: formula === undefined ? null : unescapeXml(formula),
        cached: formula !== undefined && value !== undefined ? unescapeXml(value) : null,
        inline_text: inline !== undefined,
      };
    });
    const rows = new Set(cells.map(cell => cell.row));
    return { name, hidden, part_name, cells, row_count: rows.size, max_row: Math.max(0, ...rows) };
  });
  return {
    sheets,
    named_ranges: [...workbook.matchAll(/<definedName name="([^"]*)">([\s\S]*?)<\/definedName>/g)]
      .map(match => ({ name: unescapeXml(match[1]!), refers_to: unescapeXml(match[2]!) })),
    external_link_targets: [...rels.matchAll(/Target="([^"]+)"\s+TargetMode="External"/g)].map(match => unescapeXml(match[1]!)),
    parts,
  };
}

/** ---------------------------------------------------------------- PPTX */

export type SlideShape = { shape_id: string; text: string; kind: 'text' | 'chart' | 'image' | 'unsupported' };
export type PptxSource = { slides: Array<{ shapes: SlideShape[]; notes: string | null }> };

export function buildPptx(source: PptxSource): Buffer {
  const entries: ZipEntry[] = [];
  source.slides.forEach((slide, index) => {
    const shapes = slide.shapes.map(shape =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${escapeXml(shape.shape_id)}" name="${escapeXml(shape.kind)}"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>${escapeXml(shape.text)}</a:t></a:r></a:p></p:txBody></p:sp>`).join('');
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, bytes: Buffer.from(
      `${XML_HEADER}<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`, 'utf8') });
    if (slide.notes !== null) {
      entries.push({ name: `ppt/notesSlides/notesSlide${index + 1}.xml`, bytes: Buffer.from(
        `${XML_HEADER}<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${escapeXml(slide.notes)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`, 'utf8') });
    }
    if (slide.shapes.some(shape => shape.kind === 'chart')) {
      entries.push({ name: `ppt/charts/chart${index + 1}.xml`, bytes: Buffer.from(
        `${XML_HEADER}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:val><c:numRef><c:f>Sheet1!$B$1:$B$3</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`, 'utf8') });
    }
  });
  entries.unshift({ name: 'ppt/presentation.xml', bytes: Buffer.from(
    `${XML_HEADER}<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${
      source.slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`).join('')}</p:sldIdLst></p:presentation>`, 'utf8') });
  entries.unshift({ name: '_rels/.rels', bytes: Buffer.from(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`, 'utf8') });
  entries.unshift({ name: '[Content_Types].xml', bytes: Buffer.from(`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`, 'utf8') });
  return writeZip(entries);
}

export type PptxRead = {
  slides: Array<{ slide_number: number; part_name: string; shapes: SlideShape[]; notes: string | null; chart_parts: string[] }>;
  parts: string[];
};

export function readPptx(bytes: Buffer): PptxRead {
  const parts = namesOf(bytes);
  const slideParts = parts.filter(part => /^ppt\/slides\/slide\d+\.xml$/.test(part))
    .sort((left, right) => Number(/(\d+)/.exec(left)![1]) - Number(/(\d+)/.exec(right)![1]));
  return {
    parts,
    slides: slideParts.map((part, index) => {
      const xml = readMember(bytes, part).toString('utf8');
      const shapes: SlideShape[] = [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(match => {
        const fragment = match[1]!;
        const id = /id="([^"]*)"/.exec(fragment)?.[1] ?? '';
        const kind = (/name="([^"]*)"/.exec(fragment)?.[1] ?? 'text') as SlideShape['kind'];
        const text = [...fragment.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(inner => unescapeXml(inner[1]!)).join('');
        return { shape_id: id, kind, text };
      });
      const notesPart = `ppt/notesSlides/notesSlide${index + 1}.xml`;
      const notes = parts.includes(notesPart)
        ? [...readMember(bytes, notesPart).toString('utf8').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(match => unescapeXml(match[1]!)).join('')
        : null;
      return {
        slide_number: index + 1, part_name: part, shapes, notes,
        chart_parts: parts.filter(candidate => candidate === `ppt/charts/chart${index + 1}.xml`),
      };
    }),
  };
}

function unescapeXml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Member names, read through the same inspection that enforces the container limits. */
function namesOf(bytes: Buffer): string[] {
  return inspectContainer(bytes).members.map(member => member.name);
}
