/** Support cases and incident learning.
 *
 * A case starts from something the client actually said and ends with something that was
 * actually checked. In between it links to the work that was done — a regression test, a
 * repair, a document job — and it keeps its history when the same problem is reported twice.
 *
 * Two things this module refuses outright: claiming coverage nobody configured, and sending
 * anything outward. A stopped controller monitors nothing, and saying otherwise to a client is
 * the most expensive kind of untruth.
 */
import { randomUUID } from 'node:crypto';
import type { ServiceCase } from '../../../contracts/interfaces.js';
import type { ControllerDatabase } from '../../state/src/database.js';

export class ServiceError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'ServiceError';
  }
}

export type CaseLink =
  | { kind: 'software_run'; run_id: string }
  | { kind: 'document_job'; job_id: string }
  | { kind: 'regression_test'; test_ref: string; added_at: string }
  | { kind: 'runbook'; path: string; revision: number }
  | { kind: 'deployment'; deployment_id: string };

export type ReproductionEvidence = {
  attempted: true; reproduced: boolean; observed: string; expected: string; evidence_ref: string;
} | { attempted: false; reason: string };

export type ResolutionAttempt =
  | { resolved: true; case_id: string; evidence_ref: string }
  | { resolved: false; reasons: string[] };

/** Coverage that was configured, not coverage that sounds reassuring. */
export type CoverageMode = ServiceCase['coverage_mode'];

export type CoverageStatement = {
  mode: CoverageMode;
  monitoring_configured: boolean;
  controller_running: boolean;
  /** What may honestly be said to the client, given the two booleans above. */
  statement: string;
  response_target: string | null;
};

export function describeCoverage(input: {
  monitoring_configured: boolean; controller_running: boolean; configured_response_target: string | null;
}): CoverageStatement {
  if (!input.monitoring_configured) {
    return {
      mode: 'on_demand', monitoring_configured: false, controller_running: input.controller_running,
      statement: 'Nothing is being watched for you. Tell us when something is wrong and we will look at it.',
      response_target: null,
    };
  }
  if (!input.controller_running) {
    return {
      mode: 'on_demand', monitoring_configured: true, controller_running: false,
      statement: 'Monitoring is configured but the controller is not running, so nothing is being observed right now.',
      response_target: null,
    };
  }
  return {
    mode: 'configured_service', monitoring_configured: true, controller_running: true,
    statement: 'Monitoring is configured and running.',
    response_target: input.configured_response_target,
  };
}

/** Phrases that promise cover nobody bought. */
const OVERPROMISE = /\b(24\s*[\/x]\s*7|24x7|around the clock|always on|guaranteed uptime|\d+(\.\d+)?%\s*(uptime|availability)|SLA|immediate response|instant support)\b/i;

export function reviewCoverageClaim(text: string, coverage: CoverageStatement): { publishable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (OVERPROMISE.test(text)) reasons.push('COVERAGE_CLAIM_NOT_CONFIGURED');
  if (/monitor/i.test(text) && !coverage.monitoring_configured) reasons.push('MONITORING_CLAIMED_BUT_NOT_CONFIGURED');
  if (/watching|observing/i.test(text) && !coverage.controller_running) reasons.push('OBSERVATION_CLAIMED_WHILE_STOPPED');
  return { publishable: reasons.length === 0, reasons };
}

export type OutboundAction = {
  kind: 'email' | 'sms' | 'webhook' | 'publication' | 'cloud_write_back';
  recipient: string;
  subject: string;
};

/** Nothing leaves this machine without an approval that names the action and the recipient. */
export function authoriseOutbound(input: {
  action: OutboundAction;
  approvals: ReadonlyArray<{ capability: string; recipient: string; granted_by: string }>;
}): { allowed: boolean; reason: string } {
  const grant = input.approvals.find(approval => approval.capability === input.action.kind && approval.recipient === input.action.recipient);
  return grant === undefined
    ? { allowed: false, reason: `OUTBOUND_${input.action.kind.toUpperCase()}_NOT_AUTHORIZED` }
    : { allowed: true, reason: `GRANTED_BY:${grant.granted_by}` };
}

export class ServiceCaseService {
  readonly #db: ControllerDatabase;
  readonly #now: () => string;

  constructor(db: ControllerDatabase, options: { clock?: () => string } = {}) {
    this.#db = db;
    this.#now = options.clock ?? (() => new Date().toISOString());
  }

  /** A case always references a real client request in the same project. */
  open(input: {
    project_id: string; request_id: string; severity: ServiceCase['severity'];
    coverage_mode: CoverageMode; related_run_id?: string | null; related_deployment_id?: string | null;
    summary: string;
  }): ServiceCase {
    const request = this.#db.get('SELECT request_id FROM client_requests WHERE project_id = ? AND request_id = ?',
      input.project_id, input.request_id);
    if (request === undefined) throw new ServiceError('CASE_NEEDS_A_REAL_CLIENT_REQUEST', input.request_id);
    const at = this.#now();
    const record: ServiceCase = {
      kind: 'service_case', schema_version: 1, case_id: `case_${randomUUID()}`,
      project_id: input.project_id, request_id: input.request_id, severity: input.severity,
      status: 'OPEN', coverage_mode: input.coverage_mode,
      related_run_id: input.related_run_id ?? null,
      related_deployment_id: input.related_deployment_id ?? null,
      created_at: at,
    };
    this.#db.run('INSERT INTO service_cases (case_id, project_id, request_id, severity, status, record_json, created_at) VALUES (?,?,?,?,?,?,?)',
      record.case_id, record.project_id, record.request_id, record.severity, record.status,
      JSON.stringify({ ...record, summary: input.summary, links: [] as CaseLink[], history: [{ at, event: 'opened', detail: input.summary }] }), at);
    return record;
  }

  get(case_id: string): ServiceCase & { summary: string; links: CaseLink[]; history: Array<{ at: string; event: string; detail: string }> } {
    const row = this.#db.get('SELECT record_json FROM service_cases WHERE case_id = ?', case_id);
    if (row === undefined) throw new ServiceError('UNKNOWN_CASE', case_id);
    return JSON.parse(String(row['record_json'])) as ServiceCase & { summary: string; links: CaseLink[]; history: Array<{ at: string; event: string; detail: string }> };
  }

  link(case_id: string, link: CaseLink, detail: string): void {
    const record = this.get(case_id);
    record.links.push(link);
    record.history.push({ at: this.#now(), event: `linked:${link.kind}`, detail });
    this.#save(record);
  }

  /** A second report of the same thing joins the first. Neither report is deleted, and the
   * duplicate keeps its own request id so the client who filed it can still be answered. */
  reportAgain(input: { case_id: string; project_id: string; request_id: string; summary: string }): {
    duplicate_of: string; history_length: number;
  } {
    const request = this.#db.get('SELECT request_id FROM client_requests WHERE project_id = ? AND request_id = ?',
      input.project_id, input.request_id);
    if (request === undefined) throw new ServiceError('CASE_NEEDS_A_REAL_CLIENT_REQUEST', input.request_id);
    const record = this.get(input.case_id);
    record.history.push({ at: this.#now(), event: 'duplicate_report', detail: `${input.request_id}: ${input.summary}` });
    this.#save(record);
    return { duplicate_of: input.case_id, history_length: record.history.length };
  }

  transition(case_id: string, status: ServiceCase['status'], detail: string): ServiceCase {
    const record = this.get(case_id);
    record.status = status;
    record.history.push({ at: this.#now(), event: `status:${status}`, detail });
    this.#save(record);
    this.#db.run('UPDATE service_cases SET status = ? WHERE case_id = ?', status, case_id);
    return record;
  }

  /** Resolving needs a reproduction that was attempted, a linked piece of work, and evidence
   * that the fix was checked. A confident summary is none of those. */
  resolve(input: {
    case_id: string; reproduction: ReproductionEvidence;
    verification_evidence_ref: string | null; regression_added: boolean; documentation_updated: boolean;
  }): ResolutionAttempt {
    const record = this.get(input.case_id);
    const reasons: string[] = [];
    if (!input.reproduction.attempted) reasons.push('REPRODUCTION_NOT_ATTEMPTED');
    else if (!input.reproduction.reproduced) reasons.push('NOT_REPRODUCED');
    if (input.verification_evidence_ref === null) reasons.push('NO_VERIFICATION_EVIDENCE');
    if (record.links.length === 0) reasons.push('NO_LINKED_WORK');
    if (!input.regression_added) reasons.push('NO_REGRESSION_TEST');
    if (!input.documentation_updated) reasons.push('DOCUMENTATION_NOT_UPDATED');
    if (reasons.length > 0) return { resolved: false, reasons };
    this.transition(input.case_id, 'RESOLVED', `verified by ${input.verification_evidence_ref ?? ''}`);
    return { resolved: true, case_id: input.case_id, evidence_ref: input.verification_evidence_ref! };
  }

  /** A factual timeline: what was observed, when, and what was done. No narrative, no blame. */
  timeline(case_id: string): Array<{ at: string; event: string; detail: string }> {
    return this.get(case_id).history;
  }

  #save(record: unknown): void {
    const typed = record as ServiceCase;
    this.#db.run('UPDATE service_cases SET record_json = ?, status = ? WHERE case_id = ?',
      JSON.stringify(record), typed.status, typed.case_id);
  }
}

/** Client satisfaction is client-authored. This exists so the rule has one place to live. */
export function recordSatisfaction(input: { actor: string; authenticated_client_id: string | null; satisfaction: string }):
  { recorded: boolean; reason: string } {
  if (input.actor !== 'client') return { recorded: false, reason: 'SATISFACTION_IS_CLIENT_AUTHORED_ONLY' };
  if (input.authenticated_client_id === null) return { recorded: false, reason: 'NO_AUTHENTICATED_CLIENT' };
  return { recorded: true, reason: `RECORDED_FOR:${input.authenticated_client_id}` };
}
