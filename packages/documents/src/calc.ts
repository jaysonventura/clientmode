/** Spreadsheet computation.
 *
 * The engine is small and its capability set is declared. That is the point: a function
 * outside the set is reported as unsupported and narrows the verified scope, rather than being
 * replaced by a guessed number. Nothing is evaluated as a language expression — the parser
 * only ever produces the operations listed in `SUPPORTED_FUNCTIONS`.
 *
 * Money is integer minor units throughout. A cached value stays labelled as cached until this
 * engine has recalculated it against the bound workbook, because a stale cached total is the
 * exact shape of an error that survives review.
 */
import { digest } from '../../contracts/src/canonical.js';
import { readXlsx, rowOf, type XlsxRead } from './ooxml.js';

export class CalcError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'CalcError';
  }
}

export const ENGINE = {
  name: 'client-mode-minor-unit-engine',
  version: '1.0.0',
  calculation_mode: 'manual_full_recalculation',
  locale: 'en-PH',
  date_system: '1900',
  arithmetic: 'integer minor units',
  rounding_policy: 'half-up at the minor unit',
} as const;

/** The declared capability set. Anything else is reported, never approximated. */
export const SUPPORTED_FUNCTIONS = ['SUM', 'MIN', 'MAX', 'COUNT', 'ROUND'] as const;
export type SupportedFunction = (typeof SUPPORTED_FUNCTIONS)[number];

export type CellAddress = { sheet: string; ref: string };
export type CellValue = { kind: 'number'; value: number } | { kind: 'text'; value: string } | { kind: 'error'; value: string } | { kind: 'empty' };

export type CellNode =
  | { type: 'number'; value: number }
  | { type: 'text'; value: string }
  | { type: 'ref'; address: CellAddress }
  | { type: 'range'; sheet: string; first: string; last: string }
  | { type: 'call'; name: string; args: CellNode[] }
  | { type: 'binary'; operator: '+' | '-' | '*' | '/'; left: CellNode; right: CellNode }
  | { type: 'external'; target: string }
  | { type: 'unsupported'; expression: string; reason: string };

const COLUMN = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/;

/** A deliberately small recursive-descent parser. It recognises the declared capability set
 * and nothing else; an unrecognised construct becomes an `unsupported` node with its text. */
export function parseFormula(expression: string, defaultSheet: string): CellNode {
  let cursor = 0;
  const text = expression.trim().replace(/^=/, '');
  const peek = (): string => text[cursor] ?? '';
  const eat = (character: string): boolean => { if (peek() === character) { cursor += 1; return true; } return false; };
  const skip = (): void => { while (/\s/.test(peek())) cursor += 1; };

  const unsupported = (reason: string): CellNode => ({ type: 'unsupported', expression: text, reason });

  const parseAtom = (): CellNode => {
    skip();
    if (eat('(')) {
      const inner = parseExpression();
      skip();
      if (!eat(')')) return unsupported('UNBALANCED_PARENTHESIS');
      return inner;
    }
    // A quoted sheet name, an external workbook reference, or a plain reference.
    const externalMatch = /^\[([^\]]+)\]/.exec(text.slice(cursor)) ?? /^'\[([^\]]+)\][^']*'!/.exec(text.slice(cursor));
    if (externalMatch !== null) { cursor += externalMatch[0].length; skipRef(); return { type: 'external', target: externalMatch[1]! }; }
    const quoted = /^'([^']+)'!/.exec(text.slice(cursor));
    if (quoted !== null) {
      cursor += quoted[0].length;
      return parseReference(quoted[1]!);
    }
    const bare = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(text.slice(cursor));
    if (bare !== null) { cursor += bare[0].length; return parseReference(bare[1]!); }
    const call = /^([A-Z][A-Z0-9._]*)\s*\(/i.exec(text.slice(cursor));
    if (call !== null) {
      const name = call[1]!.toUpperCase();
      cursor += call[0].length;
      const args: CellNode[] = [];
      skip();
      if (!eat(')')) {
        for (;;) {
          args.push(parseExpression());
          skip();
          if (eat(',')) continue;
          if (eat(')')) break;
          return unsupported('UNPARSEABLE_ARGUMENTS');
        }
      }
      return (SUPPORTED_FUNCTIONS as readonly string[]).includes(name)
        ? { type: 'call', name, args }
        : { type: 'unsupported', expression: text, reason: `UNSUPPORTED_FUNCTION:${name}` };
    }
    const stringLiteral = /^"([^"]*)"/.exec(text.slice(cursor));
    if (stringLiteral !== null) { cursor += stringLiteral[0].length; return { type: 'text', value: stringLiteral[1]! }; }
    const number = /^-?\d+(\.\d+)?/.exec(text.slice(cursor));
    if (number !== null && !/^[A-Z]/i.test(text.slice(cursor))) { cursor += number[0].length; return { type: 'number', value: Number(number[0]) }; }
    return parseReference(defaultSheet);
  };

  const skipRef = (): void => { const match = /^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?/.exec(text.slice(cursor)); if (match !== null) cursor += match[0].length; };

  function parseReference(sheet: string): CellNode {
    const match = /^(\$?[A-Z]{1,3}\$?\d+|\$?[A-Z]{1,3})(:(\$?[A-Z]{1,3}\$?\d+|\$?[A-Z]{1,3}))?/.exec(text.slice(cursor));
    if (match === null) return unsupported('UNRECOGNISED_TOKEN');
    cursor += match[0].length;
    const first = match[1]!.replace(/\$/g, '');
    const last = match[3]?.replace(/\$/g, '');
    if (last !== undefined) return { type: 'range', sheet, first, last };
    return COLUMN.test(first) ? { type: 'ref', address: { sheet, ref: first } } : unsupported(`WHOLE_COLUMN_REFERENCE:${first}`);
  }

  function parseTerm(): CellNode {
    let left = parseAtom();
    for (;;) {
      skip();
      const operator = peek();
      if (operator !== '*' && operator !== '/') return left;
      cursor += 1;
      left = { type: 'binary', operator, left, right: parseAtom() };
    }
  }

  function parseExpression(): CellNode {
    let left = parseTerm();
    for (;;) {
      skip();
      const operator = peek();
      if (operator !== '+' && operator !== '-') return left;
      cursor += 1;
      left = { type: 'binary', operator, left, right: parseTerm() };
    }
  }

  const node = parseExpression();
  skip();
  return cursor < text.length ? unsupported(`TRAILING_INPUT:${text.slice(cursor, cursor + 20)}`) : node;
}

export type Workbook = { read: XlsxRead; digest: string };

export function loadWorkbook(bytes: Buffer): Workbook {
  return { read: readXlsx(bytes), digest: `sha256:${digest(bytes.toString('base64')).slice(7)}` };
}

export type CalculationRequest = {
  workbook: Workbook;
  targets: CellAddress[];
  /** When absent, no engine is available and no numeric claim can be made. */
  engine?: typeof ENGINE;
  /** External links stay disabled. A required one produces UNVERIFIED, never a guess. */
  external_links_enabled?: false;
  /** Values overriding cells, for the recalculate-after-edit case. */
  overrides?: Array<{ address: CellAddress; value: number }>;
};

export type CalculatedCell = {
  address: CellAddress;
  formula: string | null;
  cached_value: string | null;
  computed: CellValue | null;
  cached_matches_computed: boolean | null;
  status: 'COMPUTED' | 'CACHED_ONLY' | 'UNSUPPORTED' | 'EXTERNAL_DEPENDENCY' | 'CYCLE' | 'NO_ENGINE';
  detail: string | null;
  /** Every cell this one actually depended on, hidden sheets included. */
  dependencies: CellAddress[];
};

export type CalculationOutcome = {
  status: 'VERIFIED' | 'UNVERIFIED' | 'NOT_APPLICABLE';
  engine: (typeof ENGINE) | null;
  cells: CalculatedCell[];
  unsupported: Array<{ address: CellAddress; reason: string }>;
  external_dependencies: Array<{ address: CellAddress; target: string }>;
  input_digest: string;
  output_digest: string;
  reasons: string[];
};

const key = (address: CellAddress): string => `${address.sheet}!${address.ref}`;

export function calculate(request: CalculationRequest): CalculationOutcome {
  const reasons: string[] = [];
  const cells: CalculatedCell[] = [];
  const unsupported: Array<{ address: CellAddress; reason: string }> = [];
  const external_dependencies: Array<{ address: CellAddress; target: string }> = [];
  const input_digest = digest({ workbook: request.workbook.digest, targets: request.targets, overrides: request.overrides ?? [] });

  if (request.engine === undefined) {
    // A missing engine is not a pass. Every target is reported unresolved.
    for (const address of request.targets) {
      cells.push({ address, formula: null, cached_value: null, computed: null, cached_matches_computed: null,
        status: 'NO_ENGINE', detail: 'no qualified calculation engine is available', dependencies: [] });
    }
    return {
      status: 'UNVERIFIED', engine: null, cells, unsupported, external_dependencies,
      input_digest, output_digest: digest(cells),
      reasons: ['NO_CALCULATION_ENGINE_AVAILABLE'],
    };
  }

  const overrides = new Map((request.overrides ?? []).map(entry => [key(entry.address), entry.value]));
  const sheetOf = (name: string): XlsxRead['sheets'][number] | undefined =>
    request.workbook.read.sheets.find(sheet => sheet.name === name);

  const cache = new Map<string, CellValue>();
  const visiting = new Set<string>();
  const dependenciesOf = new Map<string, CellAddress[]>();

  const cellValue = (address: CellAddress, trail: CellAddress[]): CellValue => {
    const identity = key(address);
    if (overrides.has(identity)) return { kind: 'number', value: overrides.get(identity)! };
    if (cache.has(identity)) return cache.get(identity)!;
    if (visiting.has(identity)) return { kind: 'error', value: '#CYCLE!' };
    visiting.add(identity);
    try {
      const sheet = sheetOf(address.sheet);
      const cell = sheet?.cells.find(candidate => candidate.ref === address.ref);
      if (cell === undefined) return { kind: 'empty' };
      trail.push(address);
      if (cell.formula !== null) {
        const value = evaluate(parseFormula(cell.formula, address.sheet), address, trail);
        cache.set(identity, value);
        return value;
      }
      const value: CellValue = cell.inline_text
        ? { kind: 'text', value: String(cell.value ?? '') }
        : cell.value === null ? { kind: 'empty' }
          : Number.isFinite(Number(cell.value)) ? { kind: 'number', value: Number(cell.value) }
            : { kind: 'text', value: String(cell.value) };
      cache.set(identity, value);
      return value;
    } finally {
      visiting.delete(identity);
    }
  };

  const rangeValues = (node: Extract<CellNode, { type: 'range' }>, owner: CellAddress, trail: CellAddress[]): CellValue[] => {
    const sheet = sheetOf(node.sheet);
    if (sheet === undefined) return [{ kind: 'error', value: '#REF!' }];
    const firstRow = rowOf(node.first);
    const lastRow = rowOf(node.last);
    const firstColumn = /^([A-Z]{1,3})/.exec(node.first)?.[1] ?? 'A';
    const lastColumn = /^([A-Z]{1,3})/.exec(node.last)?.[1] ?? firstColumn;
    const inColumn = (ref: string): boolean => {
      const column = /^([A-Z]{1,3})/.exec(ref)?.[1] ?? '';
      return column >= firstColumn && column <= lastColumn;
    };
    return sheet.cells
      .filter(cell => cell.row >= firstRow && cell.row <= lastRow && inColumn(cell.ref))
      .map(cell => cellValue({ sheet: node.sheet, ref: cell.ref }, trail));
  };

  function evaluate(node: CellNode, owner: CellAddress, trail: CellAddress[]): CellValue {
    switch (node.type) {
      case 'number': return { kind: 'number', value: node.value };
      case 'text': return { kind: 'text', value: node.value };
      case 'ref': return cellValue(node.address, trail);
      case 'range': {
        const values = rangeValues(node, owner, trail);
        return values.length === 0 ? { kind: 'empty' } : values[0]!;
      }
      case 'external':
        external_dependencies.push({ address: owner, target: node.target });
        return { kind: 'error', value: '#EXTERNAL!' };
      case 'unsupported':
        unsupported.push({ address: owner, reason: node.reason });
        return { kind: 'error', value: '#UNSUPPORTED!' };
      case 'binary': {
        const left = evaluate(node.left, owner, trail);
        const right = evaluate(node.right, owner, trail);
        if (left.kind === 'error') return left;
        if (right.kind === 'error') return right;
        const a = left.kind === 'number' ? left.value : 0;
        const b = right.kind === 'number' ? right.value : 0;
        if (node.operator === '/' && b === 0) return { kind: 'error', value: '#DIV/0!' };
        const raw = node.operator === '+' ? a + b : node.operator === '-' ? a - b : node.operator === '*' ? a * b : a / b;
        return { kind: 'number', value: roundMinorUnit(raw) };
      }
      case 'call': {
        const values = node.args.flatMap(argument =>
          argument.type === 'range' ? rangeValues(argument, owner, trail) : [evaluate(argument, owner, trail)]);
        const failure = values.find(value => value.kind === 'error');
        if (failure !== undefined) return failure;
        const numbers = values.filter((value): value is { kind: 'number'; value: number } => value.kind === 'number').map(value => value.value);
        switch (node.name as SupportedFunction) {
          case 'SUM': return { kind: 'number', value: numbers.reduce((total, value) => total + value, 0) };
          case 'MIN': return numbers.length === 0 ? { kind: 'number', value: 0 } : { kind: 'number', value: Math.min(...numbers) };
          case 'MAX': return numbers.length === 0 ? { kind: 'number', value: 0 } : { kind: 'number', value: Math.max(...numbers) };
          case 'COUNT': return { kind: 'number', value: numbers.length };
          case 'ROUND': return { kind: 'number', value: roundMinorUnit(numbers[0] ?? 0) };
          default:
            unsupported.push({ address: owner, reason: `UNSUPPORTED_FUNCTION:${node.name}` });
            return { kind: 'error', value: '#UNSUPPORTED!' };
        }
      }
    }
  }

  for (const address of request.targets) {
    const sheet = sheetOf(address.sheet);
    const cell = sheet?.cells.find(candidate => candidate.ref === address.ref);
    const trail: CellAddress[] = [];
    cache.clear();
    const computed = cell === undefined ? null : evaluate(
      cell.formula === null
        ? { type: 'ref', address }
        : parseFormula(cell.formula, address.sheet), address, trail);
    const dependencies = trail.filter(entry => key(entry) !== key(address));
    dependenciesOf.set(key(address), dependencies);
    const cached_value = cell?.cached ?? null;
    const status: CalculatedCell['status'] =
      computed === null ? 'CACHED_ONLY'
        : computed.kind === 'error' && computed.value === '#EXTERNAL!' ? 'EXTERNAL_DEPENDENCY'
          : computed.kind === 'error' && computed.value === '#UNSUPPORTED!' ? 'UNSUPPORTED'
            : computed.kind === 'error' && computed.value === '#CYCLE!' ? 'CYCLE' : 'COMPUTED';
    cells.push({
      address, formula: cell?.formula ?? null, cached_value, computed,
      cached_matches_computed: cached_value === null || computed === null || computed.kind !== 'number'
        ? null : Number(cached_value) === computed.value,
      status, detail: null, dependencies,
    });
  }

  if (unsupported.length > 0) reasons.push(`UNSUPPORTED_FORMULAS:${unsupported.length}`);
  if (external_dependencies.length > 0) reasons.push(`EXTERNAL_DEPENDENCIES_DISABLED:${external_dependencies.length}`);
  if (cells.some(cell => cell.status === 'CYCLE')) reasons.push('CIRCULAR_REFERENCE');
  const verified = reasons.length === 0 && cells.every(cell => cell.status === 'COMPUTED');
  return {
    status: verified ? 'VERIFIED' : 'UNVERIFIED', engine: request.engine, cells,
    unsupported, external_dependencies, input_digest, output_digest: digest(cells), reasons,
  };
}

/** Half-up at the minor unit. Money never travels through binary floating point rounding. */
export function roundMinorUnit(value: number): number {
  return value < 0 ? -Math.round(Math.abs(value)) : Math.round(value);
}

/** ------------------------------------------------------------------ CSV */

const FORMULA_LEAD = /^[=+\-@\t\r]/;

export type CsvExport = { text: string; escaped_cells: number; policy: string };

/** Untrusted text is exported as text. A cell that starts with a formula character is prefixed
 * so a spreadsheet opens it as the string it is, and the original value is kept beside it. */
export function exportCsv(rows: ReadonlyArray<ReadonlyArray<string>>): CsvExport {
  let escaped = 0;
  const cell = (value: string): string => {
    let out = value;
    if (FORMULA_LEAD.test(value)) { out = `'${value}`; escaped += 1; }
    return /[",\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
  };
  return {
    text: rows.map(row => row.map(cell).join(',')).join('\n') + '\n',
    escaped_cells: escaped,
    policy: "a leading =, +, -, @ or control character is prefixed with an apostrophe; the original value is retained in the source",
  };
}

export type CsvParse = {
  rows: string[][];
  /** Values kept as text: a customer id with a leading zero is not a number. */
  preserved_identifiers: string[];
  delimiter: ',' | '\t';
  encoding: 'utf-8';
};

export function parseDelimited(text: string, delimiter: ',' | '\t' = ','): CsvParse {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; continue; }
      if (character === '"') { quoted = false; continue; }
      field += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === delimiter) { row.push(field); field = ''; continue; }
    if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (character === '\r') continue;
    field += character;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const preserved = rows.flat().filter(value => /^0\d+$/.test(value));
  return { rows, preserved_identifiers: [...new Set(preserved)], delimiter, encoding: 'utf-8' };
}

/** ------------------------------------------------------------------ readiness */

export type NumericReadiness = {
  numeric_ready: boolean;
  calculation_status: 'VERIFIED' | 'UNVERIFIED' | 'NOT_APPLICABLE';
  reasons: string[];
};

/** Whether a result that depends on numbers may be called ready.
 *
 * `NOT_APPLICABLE` is only honest when the request does not depend on numeric correctness. It
 * is not a way to pass a price calculation that could not be checked. */
export function numericReadiness(input: {
  request_depends_on_numbers: boolean;
  calculation: CalculationOutcome | null;
  declared_calculation_status: 'VERIFIED' | 'UNVERIFIED' | 'NOT_APPLICABLE';
}): NumericReadiness {
  const reasons: string[] = [];
  if (!input.request_depends_on_numbers) {
    if (input.declared_calculation_status !== 'NOT_APPLICABLE') reasons.push('DECLARED_STATUS_DOES_NOT_MATCH_REQUEST');
    return { numeric_ready: reasons.length === 0, calculation_status: 'NOT_APPLICABLE', reasons };
  }
  if (input.declared_calculation_status === 'NOT_APPLICABLE') {
    reasons.push('NOT_APPLICABLE_IS_NOT_A_WAIVER_FOR_A_NUMERIC_REQUEST');
  }
  if (input.calculation === null) {
    reasons.push('NO_CALCULATION_PERFORMED');
    return { numeric_ready: false, calculation_status: 'UNVERIFIED', reasons };
  }
  if (input.calculation.engine === null) reasons.push('NO_CALCULATION_ENGINE_AVAILABLE');
  if (input.calculation.status !== 'VERIFIED') reasons.push(...input.calculation.reasons);
  const stale = input.calculation.cells.filter(cell => cell.cached_matches_computed === false);
  if (stale.length > 0) reasons.push(`CACHED_VALUES_DIFFER_FROM_RECALCULATION:${stale.map(cell => cell.address.ref).join(',')}`);
  if (input.declared_calculation_status === 'VERIFIED' && input.calculation.status !== 'VERIFIED') {
    reasons.push('DECLARED_VERIFIED_WITHOUT_A_VERIFIED_CALCULATION');
  }
  return {
    numeric_ready: reasons.length === 0,
    calculation_status: input.calculation.status,
    reasons: [...new Set(reasons)],
  };
}
