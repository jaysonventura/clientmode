/** Company responsibilities without a company.
 *
 * A responsibility is a piece of work with an accountable output, not a person to summon. A
 * button wording change does not need an architect, a product manager and a security reviewer
 * writing memos at each other; a payment change does. What decides is the risk of the work,
 * and the mapping is fixed here rather than negotiated per task.
 *
 * A title never grants permission. `Router.planResponsibilities` assigns work; the authority to
 * approve, to spend or to sign lives in the approval store and nowhere else.
 */
import type { Responsibility } from './router.js';

export class CompanyError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'CompanyError';
  }
}

export type RiskTier = 'low' | 'moderate' | 'high';

export type WorkShape = {
  request_id: string;
  summary: string;
  /** What the change touches. This is what decides the tier, not who asked. */
  surfaces: Array<'copy' | 'ui' | 'data' | 'integration' | 'payments' | 'auth' | 'infrastructure' | 'documents'>;
  stacks: string[];
  reversible: boolean;
  affects_money: boolean;
  affects_access: boolean;
};

const HIGH_RISK_SURFACES = new Set(['payments', 'auth', 'infrastructure']);

export function assessRisk(work: WorkShape): { tier: RiskTier; reasons: string[] } {
  const reasons: string[] = [];
  if (work.surfaces.some(surface => HIGH_RISK_SURFACES.has(surface))) reasons.push('HIGH_RISK_SURFACE');
  if (work.affects_money) reasons.push('AFFECTS_MONEY');
  if (work.affects_access) reasons.push('AFFECTS_ACCESS');
  if (!work.reversible) reasons.push('NOT_REVERSIBLE');
  if (reasons.length > 0) return { tier: 'high', reasons };
  if (work.stacks.length > 1 || work.surfaces.some(surface => surface === 'data' || surface === 'integration')) {
    return { tier: 'moderate', reasons: ['MULTIPLE_STACKS_OR_DATA_SURFACE'] };
  }
  return { tier: 'low', reasons: ['SINGLE_SURFACE_REVERSIBLE_CHANGE'] };
}

/** The responsibilities each tier actually needs. Everything else is scoped out with a reason,
 * which is a decision — silence is not. */
export const TIER_RESPONSIBILITIES: Record<RiskTier, Responsibility[]> = {
  low: ['engineering', 'quality'],
  moderate: ['engineering', 'quality', 'design', 'documentation'],
  high: ['architecture', 'engineering', 'quality', 'security', 'reliability', 'product', 'documentation'],
};

export type ResponsibilityPlan = {
  tier: RiskTier;
  reasons: string[];
  engaged: Responsibility[];
  scoped_out: Array<{ responsibility: Responsibility; rationale: string }>;
  /** How many concurrent workers the plan implies, against the dispatch limits. */
  implied_workers: number;
};

export function planWork(work: WorkShape, all: readonly Responsibility[]): ResponsibilityPlan {
  const risk = assessRisk(work);
  const engaged = TIER_RESPONSIBILITIES[risk.tier];
  const documentsOnly = work.surfaces.every(surface => surface === 'documents');
  return {
    tier: risk.tier, reasons: risk.reasons,
    engaged: documentsOnly ? engaged.filter(responsibility => responsibility !== 'reliability') : engaged,
    scoped_out: all.filter(responsibility => !engaged.includes(responsibility)).map(responsibility => ({
      responsibility,
      rationale: `${responsibility} is not engaged for ${risk.tier}-risk work touching ${work.surfaces.join(', ')}`,
    })),
    // One writer at a time, plus at most one reviewer. A tier does not buy more workers.
    implied_workers: risk.tier === 'low' ? 1 : 2,
  };
}

/** ------------------------------------------------------------------ outcome briefs */

export type Provenance =
  | { kind: 'client_request'; request_id: string }
  | { kind: 'document_citation'; version_id: string; content_digest: string; locator_summary: string }
  | { kind: 'code_reference'; path: string; digest: string }
  | { kind: 'observed_run'; evidence_id: string };

export type BriefClaim = {
  claim_id: string;
  statement: string;
  classification: 'observed' | 'assumption' | 'proposal';
  provenance: Provenance[];
};

export type OutcomeBrief = {
  request_id: string;
  summary: string;
  claims: BriefClaim[];
  assumptions: string[];
  /** What the client has to decide, and nothing else. */
  client_decisions: string[];
};

const RESEARCH_LANGUAGE = /\b(users? (said|told us|reported|prefer|expect)|we (interviewed|surveyed|tested with)|user (research|study|testing|interviews?)|focus group|usability (study|test)|customers? (say|prefer|want))\b/i;

/** A claim about what users said needs to have come from somewhere. Nothing in this build
 * observes real users, so a research claim without provenance is refused outright. */
export function buildBrief(input: {
  request_id: string; summary: string; claims: readonly BriefClaim[]; client_decisions: readonly string[];
}): OutcomeBrief {
  for (const claim of input.claims) {
    if (claim.classification === 'observed' && claim.provenance.length === 0) {
      throw new CompanyError('OBSERVED_CLAIM_WITHOUT_PROVENANCE', claim.claim_id);
    }
    if (RESEARCH_LANGUAGE.test(claim.statement)) {
      const fromStudy = claim.provenance.some(entry => entry.kind === 'observed_run' || entry.kind === 'client_request');
      if (!fromStudy || claim.classification !== 'observed') {
        throw new CompanyError('USER_RESEARCH_CLAIM_WITHOUT_A_STUDY', claim.claim_id);
      }
    }
  }
  return {
    request_id: input.request_id, summary: input.summary,
    claims: [...input.claims],
    assumptions: input.claims.filter(claim => claim.classification === 'assumption').map(claim => claim.statement),
    client_decisions: [...input.client_decisions],
  };
}

/** Work the client is never handed. If a decision falls in here, the engineering side owns it. */
export const MANAGEMENT_HOMEWORK = [
  'write or maintain a markdown file',
  'choose or configure agents',
  'relay a message between workers',
  'approve an implementation plan',
  'pick a library or framework',
  'research an API',
  'assign a responsibility',
  'schedule a status meeting',
  'estimate effort',
] as const;

export function isManagementHomework(decision: string): boolean {
  const text = decision.toLowerCase();
  return MANAGEMENT_HOMEWORK.some(item => text.includes(item.split(' ').slice(-2).join(' ')) || text.includes(item));
}

export function reviewClientDecisions(decisions: readonly string[]): { acceptable: string[]; homework: string[] } {
  return {
    acceptable: decisions.filter(decision => !isManagementHomework(decision)),
    homework: decisions.filter(decision => isManagementHomework(decision)),
  };
}

/** ------------------------------------------------------------------ authority */

export type AuthorityRequest = {
  actor: string;
  claimed_role: string | null;
  action: 'lower_risk_tier' | 'business_signoff' | 'purchase' | 'legal_signoff' | 'grant_permission' | 'deploy';
  subject: string;
};

export type AuthorityDecision = { allowed: boolean; reason: string };

/** Titles are labels on work. The only things that grant an action are an approval in the
 * release store and, for a business decision, the authenticated client. */
export function decideAuthority(input: {
  request: AuthorityRequest;
  approvals: ReadonlyArray<{ action: string; subject: string; granted_by: string }>;
  authenticated_client_id: string | null;
}): AuthorityDecision {
  const { request } = input;
  // A claimed role is recorded and then ignored. It is never consulted below this line.
  if (request.action === 'grant_permission') {
    return { allowed: false, reason: 'ROLE_IS_NOT_AUTHORITY' };
  }
  if (request.action === 'lower_risk_tier') {
    return { allowed: false, reason: 'RISK_TIER_IS_SET_BY_THE_WORK_NOT_BY_A_WRITER' };
  }
  if (request.action === 'business_signoff') {
    return input.authenticated_client_id !== null && request.actor === input.authenticated_client_id
      ? { allowed: true, reason: 'AUTHENTICATED_CLIENT' }
      : { allowed: false, reason: 'BUSINESS_SIGNOFF_IS_CLIENT_AUTHORED_ONLY' };
  }
  const grant = input.approvals.find(approval => approval.action === request.action && approval.subject === request.subject);
  if (grant === undefined) {
    return {
      allowed: false,
      reason: request.action === 'purchase' ? 'PURCHASE_REQUIRES_AN_APPROVED_BUDGET'
        : request.action === 'legal_signoff' ? 'LEGAL_SIGNOFF_IS_NOT_AN_ENGINEERING_ACTION'
          : 'NO_MATCHING_APPROVAL',
    };
  }
  return { allowed: true, reason: `APPROVAL_GRANTED_BY:${grant.granted_by}` };
}
