/** Report parsers. A parser turns observed process output into counted results, and it fails
 * closed: absent, malformed, or unexpectedly empty output is UNVERIFIED, never PASSED.
 *
 * Exit zero is not a pass. A candidate that prints nothing and exits zero has discovered no
 * tests, and zero discovered tests against a policy minimum is a rejection.
 */
export type ParsedReport =
  | { ok: true; tests_total: number; tests_passed: number; tests_skipped: number; assertion_ids: string[] }
  | { ok: false; reason: 'MISSING_REPORT' | 'MALFORMED_REPORT' | 'UNKNOWN_PARSER' | 'PARSER_VERSION_MISMATCH' };

export type Parser = {
  parser_id: string;
  version: string;
  parse(input: { stdout: string; stderr: string; exit_code: number | null }): ParsedReport;
};

/** TAP 13 / node:test summary output. */
const tap: Parser = {
  parser_id: 'tap13',
  version: '1.0.0',
  parse({ stdout }) {
    if (stdout.trim() === '') return { ok: false, reason: 'MISSING_REPORT' };
    const number = (label: string): number | null => {
      const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(stdout);
      return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
    };
    const total = number('tests');
    const pass = number('pass');
    const fail = number('fail');
    const skipped = number('skipped');
    if (total === null || pass === null || fail === null || skipped === null) return { ok: false, reason: 'MALFORMED_REPORT' };
    if (pass + fail + skipped > total) return { ok: false, reason: 'MALFORMED_REPORT' };
    const assertion_ids = [...stdout.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)]
      .map(match => (match[1] ?? '').trim()).filter(id => id.length > 0);
    return { ok: true, tests_total: total, tests_passed: pass, tests_skipped: skipped, assertion_ids: [...new Set(assertion_ids)] };
  },
};

/** A structured JSON report on the last non-empty stdout line. */
const jsonReport: Parser = {
  parser_id: 'json_report',
  version: '1.0.0',
  parse({ stdout }) {
    const lines = stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const last = lines[lines.length - 1];
    if (last === undefined) return { ok: false, reason: 'MISSING_REPORT' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(last);
    } catch {
      return { ok: false, reason: 'MALFORMED_REPORT' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'MALFORMED_REPORT' };
    const report = parsed as Record<string, unknown>;
    const counts = ['tests_total', 'tests_passed', 'tests_skipped'].map(key => report[key]);
    if (!counts.every(value => Number.isSafeInteger(value) && (value as number) >= 0)) return { ok: false, reason: 'MALFORMED_REPORT' };
    const assertion_ids = Array.isArray(report['assertion_ids']) ? report['assertion_ids'] : [];
    if (!assertion_ids.every(value => typeof value === 'string' && value.length > 0)) return { ok: false, reason: 'MALFORMED_REPORT' };
    return {
      ok: true, tests_total: counts[0] as number, tests_passed: counts[1] as number,
      tests_skipped: counts[2] as number, assertion_ids: assertion_ids as string[],
    };
  },
};

/** Process-only checks: the exit status is the result and no report is expected. */
const processOnly: Parser = {
  parser_id: 'process_exit',
  version: '1.0.0',
  parse({ exit_code }) {
    return { ok: true, tests_total: 0, tests_passed: 0, tests_skipped: 0, assertion_ids: exit_code === 0 ? ['process_exit_zero'] : [] };
  },
};

const PARSERS = new Map<string, Parser>([tap, jsonReport, processOnly].map(parser => [parser.parser_id, parser]));

export function parserFor(parser_id: string): Parser | undefined {
  return PARSERS.get(parser_id);
}

/** A definition pins a parser version. A parser upgrade changes check identity rather than
 * silently reinterpreting an old result. */
export function parseReport(input: {
  parser_id: string; expected_version: string; stdout: string; stderr: string; exit_code: number | null;
}): { report: ParsedReport; parser_version: string | null; version_matched: boolean } {
  const parser = PARSERS.get(input.parser_id);
  if (!parser) return { report: { ok: false, reason: 'UNKNOWN_PARSER' }, parser_version: null, version_matched: false };
  if (parser.version !== input.expected_version) {
    return { report: { ok: false, reason: 'PARSER_VERSION_MISMATCH' }, parser_version: parser.version, version_matched: false };
  }
  return {
    report: parser.parse({ stdout: input.stdout, stderr: input.stderr, exit_code: input.exit_code }),
    parser_version: parser.version, version_matched: true,
  };
}
