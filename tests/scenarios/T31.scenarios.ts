/** AT-031 executor — company responsibilities, discovery and authority.
 *
 * Three requests of very different weight go through the same routing. The wording change gets
 * two responsibilities and one worker; the payment change gets seven and a review gate. Nobody
 * is summoned to write a memo about a button.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { BudgetLedger } from '../../packages/core/src/budget.js';
import { ApprovalAuthority } from '../../packages/core/src/approvals.js';
import { DISPATCH_LIMITS, RESPONSIBILITIES, Router } from '../../packages/core/src/router.js';
import {
  assessRisk, buildBrief, decideAuthority, planWork, reviewClientDecisions,
  TIER_RESPONSIBILITIES, type WorkShape,
} from '../../packages/core/src/company.js';
import { responsibilityCoverage } from '../../packages/qualification/src/coverage.js';
import { DocumentStore } from '../../packages/documents/src/ingest.js';
import * as corpus from '../../fixtures/documents/corpus.js';
import { Evidence, attempt, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t31';
const NOW = '2026-09-09T12:00:00.000Z';

registerScenario('AT-031', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T31');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t31-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const authority = ApprovalAuthority.open(path.join(sandbox, 'release-authority'));

  try {
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}`, profile_id: 'discover', data_class: 'internal' });
    const ledger = new BudgetLedger(db, { clock });
    ledger.setPolicy({ project_id: PROJECT, cap_microusd: 5_000_000, verification_reserve_microusd: 500_000, unknown_usage_reserve_microusd: 50_000, billing_mode: 'native_account' }, 'maintainer');
    const router = new Router({ db, budget: ledger, authority, clock });
    const store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock });

    // ---- Three comparable requests -----------------------------------------------------------
    const shapes: Array<{ label: string; message: string; work: WorkShape }> = [
      {
        label: 'button_wording', message: 'change the order button to say Place order instead of Submit',
        work: { request_id: 'request_t31_button', summary: 'button wording', surfaces: ['copy'], stacks: ['TypeScript'], reversible: true, affects_money: false, affects_access: false },
      },
      {
        label: 'booking_feature', message: 'build the booking rules from these documents, the app is Swift and the service is Python',
        work: { request_id: 'request_t31_booking', summary: 'document-derived booking feature', surfaces: ['ui', 'data', 'integration', 'documents'], stacks: ['Swift', 'Python', 'TypeScript'], reversible: true, affects_money: false, affects_access: false },
      },
      {
        label: 'payment_auth', message: 'let staff refund an order and only supervisors can approve it',
        work: { request_id: 'request_t31_payment', summary: 'refund and approval permissions', surfaces: ['payments', 'auth'], stacks: ['Python'], reversible: false, affects_money: true, affects_access: true },
      },
    ];
    const plans = shapes.map(entry => ({ ...entry, risk: assessRisk(entry.work), plan: planWork(entry.work, RESPONSIBILITIES) }));

    for (const entry of plans) {
      await service.createRun({
        kind: 'client_request', schema_version: 1, request_id: entry.work.request_id, project_id: PROJECT,
        message: entry.message, language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
      }, `idem-${entry.label}`);
    }
    const runs = db.all('SELECT run_id FROM runs ORDER BY created_at').map(row => String(row['run_id']));
    const planned = plans.map((entry, index) => ({
      label: entry.label,
      assignments: router.planResponsibilities({
        project_id: PROJECT, run_id: runs[index]!, task_id: `task_${entry.label}`,
        attempt_id: null, risk_tier: entry.risk.tier, responsibilities: entry.plan.engaged,
      }),
    }));

    const small = plans[0]!;
    const substantive = plans[1]!;
    const risky = plans[2]!;
    const smallAssignments = planned[0]!.assignments;
    const noSwarm = small.risk.tier === 'low' && small.plan.engaged.length === 2 &&
      smallAssignments.length === 2 && small.plan.implied_workers === 1 &&
      small.plan.implied_workers <= DISPATCH_LIMITS.maximum_children_per_lead &&
      small.plan.scoped_out.length === RESPONSIBILITIES.length - 2 &&
      small.plan.scoped_out.every(entry => entry.rationale.length > 0) &&
      smallAssignments.every(assignment => !assignment.review_required);

    // ---- The substantive task has an owner and review outputs --------------------------------
    const substantiveAssignments = planned[1]!.assignments;
    const coverage = responsibilityCoverage({
      assignments: substantiveAssignments,
      outputs: [
        { responsibility: 'engineering', kind: 'output', ref: 'candidate:booking' },
        { responsibility: 'quality', kind: 'output', ref: 'evidence:booking' },
        { responsibility: 'design', kind: 'output', ref: 'preview:booking' },
        { responsibility: 'documentation', kind: 'output', ref: 'guide:booking' },
      ],
      observed_children_per_lead: substantive.plan.implied_workers,
      observed_depth: 1,
    });
    const substantiveHasOwners = substantive.risk.tier === 'moderate' &&
      substantiveAssignments.length === TIER_RESPONSIBILITIES.moderate.length &&
      coverage.covered && coverage.fan_out.within_limits &&
      substantive.plan.implied_workers <= DISPATCH_LIMITS.maximum_children_per_lead;

    // ---- A writer cannot lower a high-risk gate -----------------------------------------------
    const riskyAssignments = planned[2]!.assignments;
    const downgrade = decideAuthority({
      request: { actor: 'worker_1', claimed_role: 'engineering lead', action: 'lower_risk_tier', subject: 'request_t31_payment' },
      approvals: [], authenticated_client_id: 'owner_1',
    });
    const reassessed = assessRisk({ ...risky.work, affects_money: true });
    const gatesHold = risky.risk.tier === 'high' &&
      riskyAssignments.filter(assignment => assignment.review_required).length >= 4 &&
      !downgrade.allowed && downgrade.reason === 'RISK_TIER_IS_SET_BY_THE_WORK_NOT_BY_A_WRITER' &&
      reassessed.tier === 'high' &&
      TIER_RESPONSIBILITIES.high.includes('security') && TIER_RESPONSIBILITIES.high.includes('reliability');

    // ---- Research claims need provenance -----------------------------------------------------
    const documentUpload = store.upload({
      project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.pdf, bytes: corpus.pdfTerms(),
      privacy_class: 'internal', idempotency_key: 't31-pdf',
    });
    if (!documentUpload.stored) throw new Error('FIXTURE_REJECTED');
    const brief = buildBrief({
      request_id: substantive.work.request_id,
      summary: 'Booking rules taken from the supplied terms.',
      claims: [
        { claim_id: 'c1', classification: 'observed', statement: 'The supplied terms allow cancellation within 24 hours.',
          provenance: [{ kind: 'document_citation', version_id: documentUpload.version.version_id, content_digest: documentUpload.version.content_digest, locator_summary: 'page 2' }] },
        { claim_id: 'c2', classification: 'assumption', statement: 'Bookings are made in Philippine pesos unless the client says otherwise.', provenance: [] },
        { claim_id: 'c3', classification: 'proposal', statement: 'Consider showing the cancellation window on the confirmation screen.', provenance: [] },
      ],
      client_decisions: ['Which cancellation window should apply, 24 or 48 hours?'],
    });
    // Provenance is present and the claim is sourced from the client's own request, so the
    // only thing that can refuse it is the rule about research language. Leaving the
    // provenance out would have been refused a step earlier and proved less.
    const inventedResearch = attempt(() => buildBrief({
      request_id: substantive.work.request_id, summary: 'x',
      claims: [{ claim_id: 'c4', classification: 'proposal', statement: 'Users said they prefer a 48 hour window.',
        provenance: [{ kind: 'client_request', request_id: substantive.work.request_id }] }],
      client_decisions: [],
    }));
    const dressedUpResearch = attempt(() => buildBrief({
      request_id: substantive.work.request_id, summary: 'x',
      claims: [{ claim_id: 'c5', classification: 'assumption', statement: 'We interviewed customers and they want instant refunds.', provenance: [{ kind: 'client_request', request_id: substantive.work.request_id }] }],
      client_decisions: [],
    }));
    const unsourcedFact = attempt(() => buildBrief({
      request_id: substantive.work.request_id, summary: 'x',
      claims: [{ claim_id: 'c6', classification: 'observed', statement: 'The service already supports partial refunds.', provenance: [] }],
      client_decisions: [],
    }));
    const provenanceHolds = brief.claims.length === 3 && brief.assumptions.length === 1 &&
      brief.claims[0]!.provenance[0]?.kind === 'document_citation' &&
      !inventedResearch.ok && inventedResearch.message.includes('USER_RESEARCH_CLAIM_WITHOUT_A_STUDY') &&
      !dressedUpResearch.ok && !unsourcedFact.ok &&
      unsourcedFact.message.includes('OBSERVED_CLAIM_WITHOUT_PROVENANCE');

    // ---- The client is asked business questions, not given management homework ----------------
    const decisions = reviewClientDecisions([
      ...brief.client_decisions,
      'Should a refund need a supervisor?',
      'Please write a markdown file describing the agents you want us to use',
      'Approve the implementation plan before we start',
      'Pick a library or framework for the booking service',
      'Which of these two previews do you prefer?',
    ]);
    const noHomework = decisions.homework.length === 3 && decisions.acceptable.length === 3 &&
      decisions.acceptable.includes('Should a refund need a supervisor?') &&
      decisions.homework.some(item => item.includes('markdown')) &&
      decisions.homework.some(item => item.includes('implementation plan')) &&
      decisions.homework.some(item => item.toLowerCase().includes('library'));

    // ---- Titles grant nothing ------------------------------------------------------------------
    const roleEscalation = decideAuthority({
      request: { actor: 'worker_1', claimed_role: 'chief technology officer', action: 'grant_permission', subject: 'deploy:production' },
      approvals: [], authenticated_client_id: 'owner_1',
    });
    const inventedSignoff = decideAuthority({
      request: { actor: 'worker_1', claimed_role: 'product manager', action: 'business_signoff', subject: 'cancellation window' },
      approvals: [], authenticated_client_id: 'owner_1',
    });
    const clientSignoff = decideAuthority({
      request: { actor: 'owner_1', claimed_role: null, action: 'business_signoff', subject: 'cancellation window' },
      approvals: [], authenticated_client_id: 'owner_1',
    });
    const workerDecision = attempt(() => authority.decide({
      approval_id: authority.request({
        project_id: PROJECT, requested_by: 'worker', action: 'deploy', target_environment: 'production',
        policy_digest: digest({ policy: 't31' }), description: 'ship it', expires_at: '2026-09-11T00:00:00.000Z', now: NOW,
      }).approval_id,
      actor: 'worker', actor_id: 'worker_1', decision: 'approve', now: NOW,
    }));
    const titlesGrantNothing = !roleEscalation.allowed && roleEscalation.reason === 'ROLE_IS_NOT_AUTHORITY' &&
      !inventedSignoff.allowed && inventedSignoff.reason === 'BUSINESS_SIGNOFF_IS_CLIENT_AUTHORED_ONLY' &&
      clientSignoff.allowed && !workerDecision.ok &&
      // Assignments record a responsibility and a risk tier, never a permission.
      riskyAssignments.every(assignment => Object.keys(assignment).every(field => field !== 'permissions' && field !== 'authority'));

    // ---- Unapproved purchase and legal signoff -------------------------------------------------
    const purchase = decideAuthority({
      request: { actor: 'worker_1', claimed_role: 'procurement', action: 'purchase', subject: 'vendor-quote:booking-sdk' },
      approvals: [], authenticated_client_id: 'owner_1',
    });
    const legal = decideAuthority({
      request: { actor: 'worker_1', claimed_role: 'general counsel', action: 'legal_signoff', subject: 'terms of service' },
      approvals: [], authenticated_client_id: 'owner_1',
    });
    const approvedPurchase = decideAuthority({
      request: { actor: 'controller', claimed_role: null, action: 'purchase', subject: 'vendor-quote:booking-sdk' },
      approvals: [{ action: 'purchase', subject: 'vendor-quote:booking-sdk', granted_by: 'release_owner' }],
      authenticated_client_id: 'owner_1',
    });
    const apiSpend = authority.authorize({
      project_id: PROJECT, action: 'api_spend', target_environment: 'default',
      requested_by: 'controller', minimum_spend_microusd: 1_000_000, now: NOW,
    });
    const purchaseRejected = !purchase.allowed && purchase.reason === 'PURCHASE_REQUIRES_AN_APPROVED_BUDGET' &&
      !legal.allowed && legal.reason === 'LEGAL_SIGNOFF_IS_NOT_AN_ENGINEERING_ACTION' &&
      approvedPurchase.allowed && !apiSpend.authorized;

    await writer.write('responsibility-plans.json', {
      plans: plans.map(entry => ({ label: entry.label, risk: entry.risk, plan: entry.plan })),
      assignments: planned.map(entry => ({ label: entry.label, count: entry.assignments.length, review_required: entry.assignments.filter(assignment => assignment.review_required).map(assignment => assignment.responsibility) })),
      coverage, dispatch_limits: DISPATCH_LIMITS,
    } as unknown as Json);
    await writer.write('briefs-and-authority.json', {
      brief, refusals: { invented_research: inventedResearch, dressed_up_research: dressedUpResearch, unsourced_fact: unsourcedFact },
      client_decisions: decisions,
      authority: { downgrade, role_escalation: roleEscalation, invented_signoff: inventedSignoff, client_signoff: clientSignoff,
        worker_decision: workerDecision, purchase, legal, approved_purchase: approvedPurchase, api_spend: apiSpend },
      audit: authority.audit(),
    } as unknown as Json);

    return {
      scenario_id: 'AT-031',
      mode: 'integration',
      observed: {
        small_task_does_not_spawn_company_swarm: noSwarm,
        substantive_task_has_owner_and_review_outputs: substantiveHasOwners,
        high_risk_gates_cannot_be_lowered_by_writer: gatesHold,
        research_claims_have_actual_provenance: provenanceHolds,
        client_not_given_management_homework: noHomework,
        role_titles_do_not_grant_authority: titlesGrantNothing,
        unapproved_purchase_or_legal_signoff_rejected: purchaseRejected,
        responsibilities_for_small_task: small.plan.engaged.length,
        responsibilities_for_risky_task: risky.plan.engaged.length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    authority.close();
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
