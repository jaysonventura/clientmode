/** AT-033 executor — complete v1.3 qualification and closure.
 *
 * This is the last gate, and it is a sweep rather than a new feature: the document formats are
 * exercised end to end and exported, known numeric and citation defects are planted and caught,
 * a forged and a partial result are both refused a full ready, every one of the 33 gates is
 * checked for evidence, the document state is carried through an upgrade and a restore, and the
 * four signoffs are shown to be four.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CheckDefinition, DocumentPolicy, DocumentResult, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ControllerDatabase, SCHEMA_VERSION } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { DocumentStore } from '../../packages/documents/src/ingest.js';
import { DocumentJobService } from '../../packages/documents/src/jobs.js';
import { buildScope, inventoryVersion, rowCoverage } from '../../packages/documents/src/inventory.js';
import { coverageOf, extractUnits, resolveCitation } from '../../packages/documents/src/extract.js';
import { ENGINE, calculate, loadWorkbook, numericReadiness } from '../../packages/documents/src/calc.js';
import { buildReport, checkRender, describeArtifact, editDocx, prepareDownload, reopen } from '../../packages/documents/src/edit.js';
import { buildXlsx, type SheetCell } from '../../packages/documents/src/ooxml.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { EvidenceSigner, TrustStore } from '../../packages/verifier/src/evidence.js';
import { decideDocumentReadiness } from '../../packages/document-verifier/src/verdict.js';
import { DocumentPolicyStore, buildDocumentEvidence, outputManifestDigest, resultOf, sourceManifestDigest } from '../../packages/document-verifier/src/authority.js';
import { qualifiesBroadRemit } from '../../packages/qualification/src/coverage.js';
import { accountUsage, rollupCost, summariseArm, wilson, type Trial } from '../../packages/benchmark/src/aggregate.js';
import { assessRollback, restore, snapshot, upgrade, type Migration } from '../../packages/packaging/src/upgrade.js';
import { recordSatisfaction } from '../../packages/core/src/service-cases.js';
import { ApprovalAuthority } from '../../packages/core/src/approvals.js';
import { attest } from '../../packages/release/src/attestation.js';
import * as corpus from '../../fixtures/documents/corpus.js';
import { Evidence, ROOT, attempt, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t33';
const NOW = '2026-09-09T14:00:00.000Z';
const digestOf = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

registerScenario('AT-033', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T33');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t33-'));
  const stateDir = path.join(sandbox, 'state');
  const authorityDir = path.join(sandbox, 'verifier-authority');
  let db = ControllerDatabase.open(stateDir);
  const policyStore = ProtectedPolicyStore.open(authorityDir);
  const trust = new TrustStore(policyStore);
  const signer = EvidenceSigner.open({ authority_dir: authorityDir, issuer_id: 'document_verifier_t33', trust, now: NOW });
  const documentAuthority = DocumentPolicyStore.open(path.join(sandbox, 'document-authority'));
  const releaseAuthority = ApprovalAuthority.open(path.join(sandbox, 'release-authority'));

  try {
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}`, profile_id: 'discover', data_class: 'internal' });
    const store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock });
    let jobs = new DocumentJobService(db, { clock });
    await service.createRun({
      kind: 'client_request', schema_version: 1, request_id: 'request_t33', project_id: PROJECT,
      message: 'check these documents and give me a summary I can send to staff',
      language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    }, 'idem-t33');

    // ---- 1. Every format, read and exported --------------------------------------------------
    const inputs: Array<[string, string, Buffer]> = [
      ['pdf', corpus.MEDIA_TYPES.pdf, corpus.pdfTerms()],
      ['docx', corpus.MEDIA_TYPES.docx, corpus.docxPolicy()],
      ['xlsx', corpus.MEDIA_TYPES.xlsx, corpus.xlsxPricing()],
      ['pptx', corpus.MEDIA_TYPES.pptx, corpus.pptxDeck()],
      ['csv', corpus.MEDIA_TYPES.csv, corpus.csvOrders()],
      ['tsv', corpus.MEDIA_TYPES.tsv, corpus.tsvOrders()],
      ['png', corpus.MEDIA_TYPES.png, corpus.pngScreenshot()],
    ];
    const versions = new Map<string, { version: import('../../contracts/interfaces.js').DocumentVersion; bytes: Buffer }>();
    const uploaded = inputs.map(([label, media_type, bytes]) => {
      const outcome = store.upload({ project_id: PROJECT, declared_media_type: media_type, bytes, privacy_class: 'internal', idempotency_key: `t33-${label}` });
      if (!outcome.stored) throw new Error(`FIXTURE_REJECTED:${label}:${outcome.safety.refusals.join(',')}`);
      versions.set(outcome.version.version_id, { version: outcome.version, bytes });
      return { label, version: outcome.version };
    });
    const inventories = [...versions.values()].map(entry => inventoryVersion({ version: entry.version, bytes: entry.bytes }));
    const extractions = inventories.map(inventory => {
      const entry = [...versions.values()].find(candidate => candidate.version.version_id === inventory.version_id)!;
      return extractUnits({ version: entry.version, bytes: entry.bytes, units: inventory.units, workspace: path.join(sandbox, 'extract', inventory.version_id) });
    });
    const editedManual = editDocx({
      bytes: corpus.docxPolicy(),
      edits: [{ block_index: 1, text: 'This manual sets out how bookings are handled day to day.' }],
    });
    const summary = buildReport([
      { heading: 'Cancellation summary', lines: ['The published terms allow 24 hours.', 'The manual allows 48 hours.'] },
      { heading: 'Prices', lines: ['Rice 4500 centavos per kilogram.', 'Soap 2500 centavos per bar.'] },
    ]);
    const exportChecks = {
      docx: reopen({ bytes: editedManual.output_bytes, format: 'docx', expect: { sections: ['Operations Manual', 'within 48 hours of confirmation'] } }),
      xlsx: reopen({ bytes: corpus.xlsxPricing(), format: 'xlsx', expect: { sheets: ['Items', 'Adjustments'], formulas: ['SUM(B1:B1501)'] } }),
      pptx: reopen({ bytes: corpus.pptxDeck(), format: 'pptx', expect: { slides: 2 } }),
      pdf: reopen({ bytes: summary, format: 'pdf', expect: { pages: 2 }, workspace: path.join(sandbox, 'reopen') }),
    };
    const render = checkRender({
      bytes: summary, workspace: path.join(sandbox, 'render'),
      expected_text: ['Cancellation summary', 'The manual allows 48 hours.', 'Rice 4500 centavos per kilogram.'],
    });
    const formatsQualified = uploaded.length === 7 &&
      inventories.every(inventory => inventory.units.length > 0) &&
      Object.values(exportChecks).every(check => check.reopened) &&
      render.rendered && render.blank_pages.length === 0 && render.missing_text.length === 0 &&
      editedManual.meaning.preserved && extractions.some(result => result.coverage === 'PARTIAL');

    // ---- 2. Known numeric and citation defects -----------------------------------------------
    const workbook = loadWorkbook(corpus.xlsxPricing());
    const numeric = calculate({ workbook, engine: ENGINE, targets: [{ sheet: 'Items', ref: 'E1' }, { sheet: 'Items', ref: 'E3' }] });
    const staleCache = numeric.cells.filter(cell => cell.cached_matches_computed === false);
    // A workbook where row 1,501 is silently dropped: the total looks plausible and is wrong.
    const truncatedCells: SheetCell[] = Array.from({ length: 1500 }, (_, index) => ({ ref: `B${index + 1}`, value: 100 }));
    truncatedCells.push({ ref: 'E1', formula: 'SUM(B1:B1500)', cached: '150250' });
    const truncated = calculate({ workbook: loadWorkbook(buildXlsx({ sheets: [{ name: 'Items', hidden: false, cells: truncatedCells }] })), engine: ENGINE, targets: [{ sheet: 'Items', ref: 'E1' }] });
    const pdfVersion = uploaded.find(entry => entry.label === 'pdf')!.version;
    const citationWorkspace = path.join(sandbox, 'cite');
    const badCitations = [
      ['page that does not exist', { version_id: pdfVersion.version_id, content_digest: pdfVersion.content_digest, locator: { type: 'page' as const, page_number: 42 } }],
      ['excerpt that is not there', { version_id: pdfVersion.version_id, content_digest: pdfVersion.content_digest, locator: { type: 'page' as const, page_number: 1 }, excerpt: 'refunds are never given' }],
      ['digest from a different version', { version_id: pdfVersion.version_id, content_digest: `sha256:${'1'.repeat(64)}`, locator: { type: 'page' as const, page_number: 1 } }],
    ] as const;
    const citationChecks = badCitations.map(([label, citation]) => ({ label, check: resolveCitation({ citation, versions, workspace: citationWorkspace }) }));
    const goodCitation = resolveCitation({
      citation: { version_id: pdfVersion.version_id, content_digest: pdfVersion.content_digest, locator: { type: 'page', page_number: 2 }, excerpt: 'within 24 hours of confirmation' },
      versions, workspace: citationWorkspace,
    });
    const defectsCaught = staleCache.length === 2 &&
      numeric.cells[0]!.computed?.kind === 'number' && numeric.cells[0]!.computed.value === corpus.KNOWN_ANSWERS.workbook_total_centavos &&
      truncated.cells[0]!.computed?.kind === 'number' &&
      truncated.cells[0]!.computed.value !== Number(truncated.cells[0]!.cached_value) &&
      truncated.cells[0]!.cached_matches_computed === false &&
      citationChecks.every(entry => !entry.check.resolves) && goodCitation.resolves;

    // ---- 3. Partial and forged results never reach a full ready --------------------------------
    const job = jobs.create({ project_id: PROJECT, request_id: 'request_t33', operation: 'analyze', input_version_ids: uploaded.map(entry => entry.version.version_id), idempotency_key: 'job-t33' });
    jobs.transition({ job_id: job.job_id, expected_version: job.state_version, target: 'PROCESSING', actor: 'controller', reason: 'analysis', idempotency_key: 'start-t33' });
    const scope = buildScope({ job_id: job.job_id, project_id: PROJECT, scope_mode: 'entire_inputs', inventories, created_at: NOW }).scope;
    const attemptRecord = jobs.startAttempt({ job_id: job.job_id, project_id: PROJECT });
    const artifacts = [
      describeArtifact({ artifact_id: 'artifact_t33_summary', bytes: summary, media_type: corpus.MEDIA_TYPES.pdf, editable: false }),
      describeArtifact({ artifact_id: 'artifact_t33_manual', bytes: editedManual.output_bytes, media_type: corpus.MEDIA_TYPES.docx, editable: true }),
    ];
    const checks: CheckDefinition[] = [
      { check_id: 'citations_resolve', definition_digest: digest({ c: 'citations_resolve' }), required: true, result_kind: 'process', minimum_tests: 1, required_assertion_ids: ['cited_pages_exist'], maximum_skipped: 0 },
      { check_id: 'numbers_recalculated', definition_digest: digest({ c: 'numbers_recalculated' }), required: true, result_kind: 'process', minimum_tests: 2, required_assertion_ids: ['total_matches_independent_expectation', 'cached_values_labelled'], maximum_skipped: 0 },
      { check_id: 'outputs_reopen', definition_digest: digest({ c: 'outputs_reopen' }), required: true, result_kind: 'process', minimum_tests: 1, required_assertion_ids: ['exports_reopen'], maximum_skipped: 0 },
    ];
    for (const definition of checks) documentAuthority.registerCheckDefinition(definition, 'security_owner', NOW);
    const policyDraft = {
      kind: 'document_policy' as const, schema_version: 1 as const, policy_id: 'dpolicy_t33', project_id: PROJECT,
      job_id: job.job_id, instruction_revision: 1, authority: 'protected' as const, scope_digest: scope.scope_digest,
      policy_digest: '', maximum_age_seconds: 86_400, trusted_issuer_ids: ['document_verifier_t33'], checks,
    };
    const policy: DocumentPolicy = { ...policyDraft, policy_digest: digest(policyDraft, 'policy_digest') };
    documentAuthority.registerPolicy(policy, 'security_owner', NOW);
    const expected = {
      project_id: PROJECT, job_id: job.job_id, attempt_id: attemptRecord.attempt_id, instruction_revision: 1,
      scope_digest: scope.scope_digest,
      source_manifest_digest: sourceManifestDigest(uploaded.map(entry => ({ version_id: entry.version.version_id, content_digest: entry.version.content_digest }))),
      output_manifest_digest: outputManifestDigest(artifacts),
      pipeline_digest: digest({ pipeline: 't33', engine: ENGINE.version, renderer: render.renderer }),
    };
    const observations = [
      resultOf({ check_id: 'citations_resolve', definition: checks[0]!, observer_id: 'document_verifier_t33',
        observations: [{ assertion_id: 'cited_pages_exist', passed: goodCitation.resolves, detail: 'page 2 of the terms' }] }),
      resultOf({ check_id: 'numbers_recalculated', definition: checks[1]!, observer_id: 'document_verifier_t33',
        observations: [
          { assertion_id: 'total_matches_independent_expectation', passed: numeric.cells[0]!.computed?.kind === 'number' && numeric.cells[0]!.computed.value === corpus.KNOWN_ANSWERS.workbook_total_centavos, detail: '150250' },
          { assertion_id: 'cached_values_labelled', passed: staleCache.length === 2, detail: 'two cached totals differ from the recalculation' },
        ] }),
      resultOf({ check_id: 'outputs_reopen', definition: checks[2]!, observer_id: 'document_verifier_t33',
        observations: [{ assertion_id: 'exports_reopen', passed: Object.values(exportChecks).every(check => check.reopened), detail: 'docx, xlsx, pptx and pdf reopened' }] }),
    ];
    const evidence = buildDocumentEvidence({
      ...expected, issuer_id: 'document_verifier_t33', policy_digest: policy.policy_digest,
      results: observations, integrity_passed: true, blocking_findings: [],
      started_at: '2026-09-09T14:00:00.000Z', finished_at: '2026-09-09T14:00:10.000Z',
    });
    const verdict = decideDocumentReadiness({ policy, envelope: signer.sealDocument(evidence, 'document_verifier'), trust, now: '2026-09-09T14:01:00.000Z', expected });
    const partialEvidence = { ...evidence, results: observations.slice(0, 2), blocking_findings: [] };
    const partialVerdict = decideDocumentReadiness({ policy, envelope: signer.sealDocument(partialEvidence, 'document_verifier'), trust, now: '2026-09-09T14:01:00.000Z', expected });
    const forgedVerdict = decideDocumentReadiness({
      policy, envelope: signer.sealDocument({ ...evidence, integrity_passed: false }, 'document_verifier'),
      trust, now: '2026-09-09T14:01:00.000Z', expected,
    });
    const numericBlocked = numericReadiness({
      request_depends_on_numbers: true,
      calculation: calculate({ workbook, targets: [{ sheet: 'Items', ref: 'E1' }] }),
      declared_calculation_status: 'VERIFIED',
    });
    const partialNeverReady = verdict.verdict === 'READY_FOR_SCOPE' &&
      partialVerdict.verdict === 'UNVERIFIED' && partialVerdict.reasons.includes('MISSING_CHECK_outputs_reopen') &&
      forgedVerdict.verdict === 'UNVERIFIED' && forgedVerdict.reasons.includes('INTEGRITY_FAILED') &&
      !numericBlocked.numeric_ready;

    // ---- 4. Every one of the 33 gates has evidence or an explicit no-go -------------------------
    const gateSweep = Array.from({ length: 33 }, (_, index) => {
      const task = `T${String(index + 1).padStart(2, '0')}`;
      const gate = `AT-${String(index + 1).padStart(3, '0')}`;
      const directory = path.join(ROOT, 'qa', 'product', task);
      const testFile = path.join(ROOT, 'tests', 'tasks', `${task}.test.ts`);
      const scenarioFile = path.join(ROOT, 'tests', 'scenarios', `${task}.scenarios.ts`);
      const artifacts = existsSync(directory) ? readdirSync(directory).filter(entry => entry.endsWith('.json')) : [];
      const red = existsSync(path.join(directory, 'red-evidence.md'));
      // T33 is the gate producing this sweep; its own artifacts are written below.
      const self = task === 'T33';
      const has_evidence = existsSync(testFile) && existsSync(scenarioFile) && (artifacts.length > 0 || self) && (red || self);
      return { task, gate, has_evidence, artifacts: artifacts.length, red_evidence: red, status: has_evidence ? 'EVIDENCED' as const : 'NO_GO' as const };
    });
    const noGo = gateSweep.filter(entry => entry.status === 'NO_GO');
    const allGatesEvidenced = noGo.length === 0 && gateSweep.length === 33;

    // ---- 5. Document work does not stand in for cross-stack qualification -----------------------
    const documentOnlyResults = uploaded.map(entry => ({ stack: 'typescript' as const, outcome: 'ACCEPTED' }));
    const documentOnlyRemit = qualifiesBroadRemit(documentOnlyResults);
    const crossStack = qualifiesBroadRemit([
      { stack: 'typescript', outcome: 'ACCEPTED' }, { stack: 'python', outcome: 'ACCEPTED' },
      { stack: 'swift', outcome: 'ACCEPTED' }, { stack: 'rust', outcome: 'ACCEPTED' },
    ]);
    const holdout = existsSync(path.join(ROOT, 'qa/product/T23/qualification.json'))
      ? JSON.parse(readFileSync(path.join(ROOT, 'qa/product/T23/qualification.json'), 'utf8')) as { stacks: Record<string, { executed: number }>; broad_remit: { qualified: boolean } }
      : null;
    const crossStackHolds = !documentOnlyRemit.qualified &&
      documentOnlyRemit.reasons.includes('JAVASCRIPT_ONLY_RESULT_SET') && crossStack.qualified &&
      holdout !== null && holdout.broad_remit.qualified &&
      Object.entries(holdout.stacks).filter(([, value]) => value.executed > 0).length >= 4;

    // ---- 6. The comparison counts every attempt and every cost -----------------------------------
    const documentAttempt = jobs.startAttempt({ job_id: job.job_id, project_id: PROJECT });
    jobs.recordUsage({ project_id: PROJECT, job_id: job.job_id, attempt_id: attemptRecord.attempt_id, provider: 'fixture', provider_event_id: 't33-1', cost_microusd: 12_000 });
    jobs.recordUsage({ project_id: PROJECT, job_id: job.job_id, attempt_id: documentAttempt.attempt_id, provider: 'fixture', provider_event_id: 't33-2', cost_microusd: null });
    const duplicateUsage = jobs.recordUsage({ project_id: PROJECT, job_id: job.job_id, attempt_id: documentAttempt.attempt_id, provider: 'fixture', provider_event_id: 't33-2', cost_microusd: null });
    const documentUsageRows = db.all('SELECT attempt_id, measured_cost_microusd, usage_complete FROM document_usage WHERE job_id = ?', job.job_id);
    const trials: Trial[] = [
      { trial_id: 'a', spec_id: 's', family: 'web', arm: 'clientmode_bounded_agents', repeat: 1, order_index: 0,
        provider_id: 'fixture', provider_version: null, snapshot_digest: 'sha256:x', grader_id: 'g', budget_policy_digest: 'sha256:b',
        outcome: 'ACCEPTED', accepted_by_grader: true, false_ready: false, client_questions: 0, wall_ms: 10,
        blocked_reason: null, injected_defect: 'none', repaired: false, grader_reasons: [],
        usage: [{ event_id: 'u1', attempt_id: 'at1', cost_microusd: 12_000, usage_complete: true }] },
      { trial_id: 'b', spec_id: 's', family: 'web', arm: 'clientmode_bounded_agents', repeat: 2, order_index: 1,
        provider_id: 'fixture', provider_version: null, snapshot_digest: 'sha256:x', grader_id: 'g', budget_policy_digest: 'sha256:b',
        outcome: 'REJECTED', accepted_by_grader: false, false_ready: true, client_questions: 0, wall_ms: 10,
        blocked_reason: null, injected_defect: 'semantic', repaired: false, grader_reasons: ['CHECK_FAILED'],
        usage: [{ event_id: 'u2', attempt_id: 'at2', cost_microusd: null, usage_complete: false }] },
      { trial_id: 'c', spec_id: 's', family: 'web', arm: 'clientmode_bounded_agents', repeat: 3, order_index: 2,
        provider_id: 'fixture', provider_version: null, snapshot_digest: 'sha256:x', grader_id: 'g', budget_policy_digest: 'sha256:b',
        outcome: 'BLOCKED', accepted_by_grader: false, false_ready: false, client_questions: 1, wall_ms: 0,
        blocked_reason: 'MISSING_ENVIRONMENT:go', injected_defect: 'none', repaired: false, grader_reasons: [],
        usage: [{ event_id: 'u3', attempt_id: 'at3', cost_microusd: null, usage_complete: false },
                { event_id: 'u1', attempt_id: 'at1', cost_microusd: 12_000, usage_complete: true }] },
    ];
    const arm = summariseArm('clientmode_bounded_agents', trials, 50_000);
    const cost = rollupCost(trials, 50_000);
    const usageAccounting = accountUsage(trials, new Set(['at1', 'at2', 'at3']));
    const interval = wilson(arm.accepted, arm.trials);
    const comparisonCounts = arm.trials === 3 && arm.accepted === 1 && arm.blocked === 1 &&
      Math.abs(arm.accepted_rate - 1 / 3) < 1e-9 && cost.unknown_events === 2 &&
      cost.reserved_for_unknown_microusd === 100_000 && cost.duplicate_events_flagged.includes('u1') &&
      cost.coverage === 'partial' && usageAccounting.flagged.length === 3 &&
      interval.high - interval.low > 0.3 &&
      duplicateUsage.duplicate && documentUsageRows.length === 2 &&
      documentUsageRows.some(row => row['usage_complete'] === 0);

    // ---- 7. Document state survives an upgrade and a restore --------------------------------------
    jobs.transition({ job_id: job.job_id, expected_version: jobs.get(job.job_id).state_version, target: 'VERIFYING', actor: 'controller', reason: 'qa', idempotency_key: 'verify-t33' });
    const result: DocumentResult = {
      kind: 'document_result', schema_version: 1, result_id: `dres_${job.job_id}`, job_id: job.job_id,
      project_id: PROJECT, instruction_revision: 1, source_scope_digest: scope.scope_digest,
      source_version_ids: uploaded.map(entry => entry.version.version_id), coverage: 'PARTIAL',
      limitations: ['One page has no text layer and no OCR engine is installed.'],
      calculation_status: 'VERIFIED', qa_evidence_ref: evidence.evidence_id, artifacts, created_at: NOW,
    };
    jobs.recordResult(result);
    const readyJob = jobs.transition({
      job_id: job.job_id, expected_version: jobs.get(job.job_id).state_version, target: 'READY',
      actor: 'document_verifier', reason: 'document QA passed', idempotency_key: 'ready-t33', result_id: result.result_id,
    });
    const documentRowsBefore = {
      versions: Number(db.get('SELECT COUNT(*) AS n FROM document_versions')?.['n'] ?? 0),
      jobs: Number(db.get('SELECT COUNT(*) AS n FROM document_jobs')?.['n'] ?? 0),
      results: Number(db.get('SELECT COUNT(*) AS n FROM document_results')?.['n'] ?? 0),
      usage: Number(db.get('SELECT COUNT(*) AS n FROM document_usage')?.['n'] ?? 0),
    };
    db.close();

    const statePath = path.join(stateDir, 'state.sqlite');
    const backupDir = path.join(sandbox, 'backups');
    let activated = '1.3.0';
    const migrations: Migration[] = [
      { version: 5, kind: 'expand', reversible: true, apply: () => {
        const upgradeDb = ControllerDatabase.open(stateDir);
        upgradeDb.run('ALTER TABLE document_jobs ADD COLUMN closed_at TEXT');
        upgradeDb.close();
      } },
    ];
    const upgraded = upgrade({
      state_path: statePath, config_path: null, backup_dir: backupDir,
      from_version: '1.3.0', to_version: '1.3.1', migrations,
      activate: version => { activated = version; }, now: NOW,
    });
    db = ControllerDatabase.open(stateDir);
    const afterUpgrade = {
      versions: Number(db.get('SELECT COUNT(*) AS n FROM document_versions')?.['n'] ?? 0),
      jobs: Number(db.get('SELECT COUNT(*) AS n FROM document_jobs')?.['n'] ?? 0),
      results: Number(db.get('SELECT COUNT(*) AS n FROM document_results')?.['n'] ?? 0),
      usage: Number(db.get('SELECT COUNT(*) AS n FROM document_usage')?.['n'] ?? 0),
      job_state: String(db.get('SELECT state FROM document_jobs WHERE job_id = ?', job.job_id)?.['state'] ?? ''),
      new_column: db.all('PRAGMA table_info(document_jobs)').some(row => String(row['name']) === 'closed_at'),
    };
    db.close();
    const rollbackAssessment = assessRollback(migrations, upgraded.snapshot);
    restore({ snapshot: upgraded.snapshot, state_path: statePath, config_path: null });
    db = ControllerDatabase.open(stateDir);
    const afterRestore = {
      versions: Number(db.get('SELECT COUNT(*) AS n FROM document_versions')?.['n'] ?? 0),
      jobs: Number(db.get('SELECT COUNT(*) AS n FROM document_jobs')?.['n'] ?? 0),
      results: Number(db.get('SELECT COUNT(*) AS n FROM document_results')?.['n'] ?? 0),
      usage: Number(db.get('SELECT COUNT(*) AS n FROM document_usage')?.['n'] ?? 0),
      job_state: String(db.get('SELECT state FROM document_jobs WHERE job_id = ?', job.job_id)?.['state'] ?? ''),
      new_column: db.all('PRAGMA table_info(document_jobs)').some(row => String(row['name']) === 'closed_at'),
    };
    jobs = new DocumentJobService(db, { clock: fixedClock(NOW) });
    const stateSurvives = upgraded.upgraded && activated === '1.3.1' &&
      afterUpgrade.versions === documentRowsBefore.versions && afterUpgrade.jobs === documentRowsBefore.jobs &&
      afterUpgrade.results === documentRowsBefore.results && afterUpgrade.usage === documentRowsBefore.usage &&
      afterUpgrade.job_state === 'READY' && afterUpgrade.new_column &&
      afterRestore.versions === documentRowsBefore.versions && afterRestore.job_state === 'READY' &&
      !afterRestore.new_column && rollbackAssessment.rollback_safe &&
      jobs.get(job.job_id).state === 'READY' && SCHEMA_VERSION >= 4;

    // ---- 8. Client acceptance is not technical readiness -------------------------------------------
    const technicallyReady = readyJob.state === 'READY' && verdict.verdict === 'READY_FOR_SCOPE';
    const runId = db.all('SELECT run_id FROM runs LIMIT 1').map(row => String(row['run_id']))[0]!;
    // Feedback references a candidate, so the candidate has to exist. It is recorded here as the
    // artifact the client is looking at.
    db.run(`INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest,
      requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      'candidate_t33', PROJECT, runId, digestOf(summary), artifacts[0]!.content_digest, 1,
      policy.policy_digest, digest({ e: 't33' }), NOW);
    const clientRejects = new LifecycleService(db, { clock: fixedClock(NOW) }).recordFeedback({
      project_id: PROJECT, run_id: runId,
      candidate_id: 'candidate_t33', message: 'technically fine but this is not what I meant',
      satisfaction: 'needs_changes', actor: 'client', authenticated_actor_id: 'owner_1',
    });
    const agentSatisfaction = recordSatisfaction({ actor: 'worker', authenticated_client_id: 'owner_1', satisfaction: 'accepted' });
    const acceptanceDistinct = technicallyReady && clientRejects.recorded &&
      clientRejects.satisfaction === 'needs_changes' && !agentSatisfaction.recorded &&
      // The job is still technically READY; the client's view did not change the verdict.
      jobs.get(job.job_id).state === 'READY';

    // ---- 9. Only verified, authorised artifacts are released ----------------------------------------
    const attestation = attest({
      candidate: {
        kind: 'candidate', schema_version: 1, candidate_id: 'candidate_t33', project_id: PROJECT,
        run_id: 'run_t33', source_digest: digestOf(summary), artifact_digest: artifacts[0]!.content_digest,
        requirements_revision: 1, policy_digest: policy.policy_digest,
        environment_digest: digest({ e: 't33' }), created_at: NOW,
      },
      verdict: { verdict: 'VERIFIED_FOR_SCOPE', reasons: [], candidate_id: 'candidate_t33', evidence_id: evidence.evidence_id },
      issuer_id: 'document_verifier_t33', issued_at: NOW,
    });
    const unapproved = releaseAuthority.authorize({
      project_id: PROJECT, action: 'deploy', target_environment: 'production',
      candidate_id: 'candidate_t33', artifact_digest: artifacts[0]!.content_digest,
      requested_by: 'controller', now: NOW,
    });
    const requested = releaseAuthority.request({
      project_id: PROJECT, requested_by: 'controller', action: 'deploy', target_environment: 'staging',
      policy_digest: policy.policy_digest, description: 'release the summary', expires_at: '2026-09-11T00:00:00.000Z',
      now: NOW, candidate_id: 'candidate_t33', artifact_digest: artifacts[0]!.content_digest,
    });
    releaseAuthority.decide({ approval_id: requested.approval_id, actor: 'release', actor_id: 'release_owner', decision: 'approve', now: NOW });
    const approved = releaseAuthority.authorize({
      project_id: PROJECT, action: 'deploy', target_environment: 'staging',
      candidate_id: 'candidate_t33', artifact_digest: artifacts[0]!.content_digest,
      requested_by: 'controller', now: NOW,
    });
    const wrongArtifact = releaseAuthority.authorize({
      project_id: PROJECT, action: 'deploy', target_environment: 'staging',
      candidate_id: 'candidate_t33', artifact_digest: digestOf(Buffer.from('a different artifact')),
      requested_by: 'controller', now: NOW,
    });
    const download = prepareDownload({ artifact: artifacts[0]!, bytes: summary, requested_name: 'summary.pdf' });
    const tamperedDownload = prepareDownload({ artifact: artifacts[0]!, bytes: Buffer.concat([summary, Buffer.from('x')]), requested_name: 'summary.pdf' });
    const releasedOnlyVerified = !unapproved.authorized && approved.authorized && !wrongArtifact.authorized &&
      attestation.artifact_digest === artifacts[0]!.content_digest &&
      download.allowed && !tamperedDownload.allowed;

    await writer.write('closure.json', {
      formats: uploaded.map(entry => ({ label: entry.label, version_id: entry.version.version_id, format: entry.version.format })),
      inventories: inventories.map(inventory => ({ format: inventory.format, units: inventory.units.length, totals: inventory.totals })),
      exports: exportChecks, render: { pages: render.pages.map(page => ({ page: page.page_number, ink: page.ink_ratio })), blank: render.blank_pages, missing: render.missing_text, renderer: render.renderer },
      numeric: { cells: numeric.cells.map(cell => ({ ref: cell.address.ref, computed: cell.computed, cached: cell.cached_value, matches: cell.cached_matches_computed })), truncated: truncated.cells[0] },
      citations: { good: goodCitation.resolves, refused: citationChecks.map(entry => ({ label: entry.label, reason: entry.check.resolves ? null : entry.check.reason })) },
      qa: { verdict, partial: partialVerdict, forged: forgedVerdict, numeric_without_engine: numericBlocked },
      row_coverage: rowCoverage(inventories.find(inventory => inventory.format === 'xlsx')!.units, 'Items'),
      coverage: coverageOf({ scope_unit_ids: scope.units.map(unit => unit.unit_id), extracted: extractions.flatMap(entry => entry.units) }),
    } as unknown as Json);
    await writer.write('gate-sweep.json', gateSweep as unknown as Json);
    await writer.write('closure-checks.json', {
      cross_stack: { document_only: documentOnlyRemit, cross_stack: crossStack, holdout_stacks: holdout?.stacks ?? null },
      comparison: { arm, cost, usage: usageAccounting, interval, document_usage_rows: documentUsageRows },
      upgrade: { upgraded, activated, before: documentRowsBefore, after_upgrade: afterUpgrade, after_restore: afterRestore, rollback: rollbackAssessment },
      acceptance: { technically_ready: technicallyReady, client_feedback: clientRejects, agent_satisfaction: agentSatisfaction, job_state: jobs.get(job.job_id).state },
      release: { attestation, unapproved, approved, wrong_artifact: wrongArtifact, download, tampered_download: tamperedDownload },
      scope: 'Base and document qualification on this machine. No production deployment, no paid service, and no metered evaluation budget; the provider comparison arms remain simulated and are named as such in AT-022.',
    } as unknown as Json);

    return {
      scenario_id: 'AT-033',
      mode: 'qualification',
      observed: {
        real_document_formats_and_exports_qualified: formatsQualified,
        known_numeric_and_citation_defects_caught: defectsCaught,
        partial_or_forged_results_never_full_ready: partialNeverReady,
        all_33_task_gates_have_evidence_or_no_go: allGatesEvidenced,
        cross_stack_qualification_not_replaced_by_docs: crossStackHolds,
        comparison_counts_all_attempts_and_costs: comparisonCounts,
        new_document_state_survives_upgrade_restore: stateSurvives,
        client_acceptance_distinct_from_technical_ready: acceptanceDistinct,
        only_verified_authorized_artifacts_released: releasedOnlyVerified,
        gates_evidenced: gateSweep.filter(entry => entry.status === 'EVIDENCED').length,
        gates_no_go: noGo.map(entry => entry.gate),
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    releaseAuthority.close();
    documentAuthority.close();
    policyStore.close();
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
