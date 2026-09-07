/** AT-029 executor — editing, technical writing, export and protected document QA.
 *
 * Every output is a new artifact, reopened by an independent read path and rendered before
 * anyone is told it is ready. The documentation is corrected from what the running service
 * actually did, not from what its published table claimed. And the writer cannot award READY:
 * the document authority signs its own evidence, and the software evaluator refuses to open it.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CheckDefinition, DocumentPolicy, DocumentResult, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { DocumentStore } from '../../packages/documents/src/ingest.js';
import { DocumentJobService } from '../../packages/documents/src/jobs.js';
import { buildScope, inventoryVersion } from '../../packages/documents/src/inventory.js';
import { buildReport, checkMeaning, checkRender, describeArtifact, editDocx, prepareDownload, reopen } from '../../packages/documents/src/edit.js';
import { correctDocumentation, executeSnippet } from '../../packages/documents/src/writing.js';
import { ENGINE, calculate, loadWorkbook } from '../../packages/documents/src/calc.js';
import { buildXlsx, readPptx, readXlsx } from '../../packages/documents/src/ooxml.js';
import { buildPdf as buildPdfFile } from '../../packages/documents/src/pdf.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { EvidenceSigner, TrustStore, openEnvelope } from '../../packages/verifier/src/evidence.js';
import { decideDocumentReadiness } from '../../packages/document-verifier/src/verdict.js';
import { DocumentPolicyStore, buildDocumentEvidence, outputManifestDigest, resultOf, sourceManifestDigest } from '../../packages/document-verifier/src/authority.js';
import * as corpus from '../../fixtures/documents/corpus.js';
import { Evidence, attempt, fixedClock } from '../harness/evidence.js';
import { startPricingApi } from '../harness/services.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t29';
const NOW = '2026-09-09T10:00:00.000Z';
const digestOf = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

registerScenario('AT-029', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T29');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t29-'));
  const authorityDir = path.join(sandbox, 'verifier-authority');
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const policyStore = ProtectedPolicyStore.open(authorityDir);
  const trust = new TrustStore(policyStore);
  const signer = EvidenceSigner.open({ authority_dir: authorityDir, issuer_id: 'document_verifier_t29', trust, now: NOW });
  const documentAuthority = DocumentPolicyStore.open(path.join(sandbox, 'document-authority'));
  const running: Array<{ stop: () => Promise<void> }> = [];

  try {
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}`, profile_id: 'discover', data_class: 'internal' });
    const store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock });
    const jobs = new DocumentJobService(db, { clock });
    await service.createRun({
      kind: 'client_request', schema_version: 1, request_id: 'request_t29', project_id: PROJECT,
      message: 'tidy up the manual and update the API docs', language_hint: 'en',
      attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    }, 'idem-t29');

    // ---- 1. Edit a DOCX without changing what it means ------------------------------------
    const originalDocx = corpus.docxPolicy();
    const originalPath = path.join(sandbox, 'original.docx');
    writeFileSync(originalPath, originalDocx);
    const originalDigest = digestOf(originalDocx);
    const docxVersion = store.upload({ project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.docx, bytes: originalDocx, privacy_class: 'internal', idempotency_key: 't29-docx' });
    if (!docxVersion.stored) throw new Error('FIXTURE_REJECTED');

    const edited = editDocx({
      bytes: originalDocx,
      edits: [
        { block_index: 1, text: 'This manual sets out how bookings are handled day to day.' },
        { block_index: 5, text: 'Any dispute goes to the operations lead.' },
      ],
    });
    const forbidden = editDocx({
      bytes: originalDocx,
      edits: [{ block_index: 3, text: 'Staff may cancel a booking within 72 hours of confirmation.' }],
    });
    const onDiskAfter = digestOf(readFileSync(originalPath));
    const storedAfter = digestOf(store.read({ project_id: PROJECT, version_id: docxVersion.version.version_id }));
    const originalsUnchanged = onDiskAfter === originalDigest && storedAfter === originalDigest &&
      edited.output_digest !== originalDigest;
    const meaningPreserved = edited.meaning.preserved && !forbidden.meaning.preserved &&
      forbidden.meaning.changes.some(change => change.rule_id === 'cancellation_window') &&
      checkMeaning('cancel within 24 hours', 'cancel within 48 hours').preserved === false;

    // ---- 2. Reopen every editable output ---------------------------------------------------
    const editedDocxCheck = reopen({
      bytes: edited.output_bytes, format: 'docx',
      expect: { sections: ['Operations Manual', 'Cancellation', 'within 48 hours of confirmation', 'Any dispute goes to the operations lead.'] },
    });
    const workbookBytes = corpus.xlsxPricing();
    const workbook = loadWorkbook(workbookBytes);
    const recalculated = calculate({
      workbook, engine: ENGINE, targets: [{ sheet: 'Items', ref: 'E1' }],
      overrides: [{ address: { sheet: 'Items', ref: 'B1501' }, value: 500 }],
    });
    const editedWorkbook = buildXlsx({
      sheets: [
        { name: 'Items', hidden: false, cells: [
          ...Array.from({ length: 1500 }, (_, index) => ({ ref: `B${index + 1}`, value: 100 })),
          { ref: 'B1501', value: 500 },
          { ref: 'E1', formula: 'SUM(B1:B1501)', cached: String(recalculated.cells[0]!.computed?.kind === 'number' ? recalculated.cells[0]!.computed.value : '') },
        ] },
        { name: 'Adjustments', hidden: true, cells: [{ ref: 'A1', value: 'bulk discount', text: true }, { ref: 'B1', value: -5000 }] },
      ],
      named_ranges: [{ name: 'GrandTotal', refers_to: 'Items!$E$1' }],
    });
    const workbookCheck = reopen({
      bytes: editedWorkbook, format: 'xlsx',
      expect: { sheets: ['Items', 'Adjustments'], formulas: ['SUM(B1:B1501)'] },
    });
    const deckCheck = reopen({ bytes: corpus.pptxDeck(), format: 'pptx', expect: { slides: 2 } });
    const chartStillEditable = readPptx(corpus.pptxDeck()).slides[0]!.chart_parts.length === 1;
    const reopenedFormulas = readXlsx(editedWorkbook).sheets[0]!.cells.filter(cell => cell.formula !== null).length;
    const outputsReopen = editedDocxCheck.reopened && workbookCheck.reopened && deckCheck.reopened &&
      chartStillEditable && reopenedFormulas === 1 &&
      recalculated.cells[0]!.computed?.kind === 'number' && recalculated.cells[0]!.computed.value === 150_500;

    // ---- 3. Export a report, render it, and catch a layout failure --------------------------
    const report = buildReport([
      { heading: 'Cancellation review', lines: ['The published terms allow 24 hours.', 'The manual allows 48 hours.', 'One rule should be chosen.'] },
      { heading: 'Pricing', lines: ['Rice is 4500 centavos per kilogram.', 'Soap is 2500 centavos per bar.'] },
    ]);
    const goodRender = checkRender({
      bytes: report, workspace: path.join(sandbox, 'render-good'),
      expected_text: ['Cancellation review', 'The manual allows 48 hours.', 'Rice is 4500 centavos per kilogram.'],
    });
    // The same report with its content drawn outside the page box: extraction may still find
    // the string, but the page comes back blank when it is rendered.
    const clipped = Buffer.from(buildPdfFile([
      { lines: ['Cancellation review', 'The manual allows 48 hours.'], scanned: false },
    ]).toString('latin1').replace(/Td/g, ' 4000 Td'), 'latin1');
    const clippedRender = checkRender({ bytes: clipped, workspace: path.join(sandbox, 'render-clipped') });
    const renderCaught = goodRender.rendered && goodRender.blank_pages.length === 0 &&
      goodRender.missing_text.length === 0 && goodRender.pages.length === 2 &&
      goodRender.scope === 'all_pages' &&
      clippedRender.rendered && clippedRender.blank_pages.length > 0;

    // ---- 4. Documentation checked against the running service -------------------------------
    const api = await startPricingApi();
    running.push(api);
    const documented = await executeSnippet({
      snippet_id: 'price-example', base_url: api.url, path_and_query: '/price?product=rice&qty=2',
      expected_status: 200, expected_body_contains: '"total_centavos":9000',
    });
    const observed = await executeSnippet({
      snippet_id: 'price-example-corrected', base_url: api.url, path_and_query: '/price?product=rice&quantity=2',
      expected_status: 200, expected_body_contains: '"total_centavos":9000',
    });
    const corrected = correctDocumentation({
      documentation: corpus.API_DOCUMENTATION,
      defects: [{ snippet_id: 'price-example', documented: 'qty', observed: 'quantity', correction: 'the implementation reads `quantity`' }],
    });
    const recheck = await executeSnippet({
      snippet_id: 'price-example-after-correction', base_url: api.url,
      path_and_query: `/price?product=rice&${/quantity/.test(corrected.text) ? 'quantity' : 'qty'}=2`,
      expected_status: 200, expected_body_contains: '"total_centavos":9000',
    });
    const examplesExecuted = documented.executed && !documented.matches_documentation &&
      observed.executed && observed.matches_documentation &&
      corrected.applied.length === 1 && !corrected.text.includes('&qty=') &&
      recheck.matches_documentation && recheck.target_version === '2.4.0' &&
      observed.target_version === '2.4.0';

    // ---- 5. Protected document QA -------------------------------------------------------------
    const job = jobs.create({
      project_id: PROJECT, request_id: 'request_t29', operation: 'edit',
      input_version_ids: [docxVersion.version.version_id], idempotency_key: 'job-t29',
    });
    jobs.transition({ job_id: job.job_id, expected_version: job.state_version, target: 'PROCESSING', actor: 'controller', reason: 'editing', idempotency_key: 'start-t29' });
    const scope = buildScope({
      job_id: job.job_id, project_id: PROJECT, scope_mode: 'entire_inputs',
      inventories: [inventoryVersion({ version: docxVersion.version, bytes: originalDocx })], created_at: NOW,
    }).scope;
    const artifacts = [
      describeArtifact({ artifact_id: 'artifact_manual', bytes: edited.output_bytes, media_type: corpus.MEDIA_TYPES.docx, editable: true }),
      describeArtifact({ artifact_id: 'artifact_report', bytes: report, media_type: corpus.MEDIA_TYPES.pdf, editable: false }),
    ];
    const source_manifest_digest = sourceManifestDigest([{ version_id: docxVersion.version.version_id, content_digest: docxVersion.version.content_digest }]);
    const output_manifest_digest = outputManifestDigest(artifacts);
    const pipeline_digest = digest({ editor: 'first-party OOXML', renderer: goodRender.renderer, engine: ENGINE.version });

    const checks: CheckDefinition[] = [
      { check_id: 'meaning_preserved', definition_digest: digest({ check: 'meaning_preserved' }), required: true, result_kind: 'process', minimum_tests: 3, required_assertion_ids: ['cancellation_window', 'unit_prices', 'permissions'], maximum_skipped: 0 },
      { check_id: 'output_reopens', definition_digest: digest({ check: 'output_reopens' }), required: true, result_kind: 'process', minimum_tests: 2, required_assertion_ids: ['docx_reopens', 'sections_present'], maximum_skipped: 0 },
      { check_id: 'render_inspected', definition_digest: digest({ check: 'render_inspected' }), required: true, result_kind: 'browser', minimum_tests: 2, required_assertion_ids: ['no_blank_pages', 'expected_text_present'], maximum_skipped: 0 },
    ];
    for (const definition of checks) documentAuthority.registerCheckDefinition(definition, 'security_owner', NOW);
    const policyDraft = {
      kind: 'document_policy' as const, schema_version: 1 as const, policy_id: 'dpolicy_t29',
      project_id: PROJECT, job_id: job.job_id, instruction_revision: 1, authority: 'protected' as const,
      scope_digest: scope.scope_digest, policy_digest: '', maximum_age_seconds: 86_400,
      trusted_issuer_ids: ['document_verifier_t29'], checks,
    };
    const policy: DocumentPolicy = { ...policyDraft, policy_digest: digest(policyDraft, 'policy_digest') };
    documentAuthority.registerPolicy(policy, 'security_owner', NOW);
    const workerPolicy = attempt(() => documentAuthority.registerPolicy({ ...policy, policy_id: 'dpolicy_worker' }, 'worker', NOW));

    const attemptRecord = jobs.startAttempt({ job_id: job.job_id, project_id: PROJECT });
    const results = [
      resultOf({ check_id: 'meaning_preserved', definition: checks[0]!, observer_id: 'document_verifier_t29',
        observations: [
          { assertion_id: 'cancellation_window', passed: edited.meaning.changes.every(change => change.rule_id !== 'cancellation_window'), detail: '48 hours before and after' },
          { assertion_id: 'unit_prices', passed: edited.meaning.changes.every(change => change.rule_id !== 'unit_prices'), detail: '4500 and 2500 unchanged' },
          { assertion_id: 'permissions', passed: edited.meaning.changes.every(change => change.rule_id !== 'permissions'), detail: 'may cancel unchanged' },
        ] }),
      resultOf({ check_id: 'output_reopens', definition: checks[1]!, observer_id: 'document_verifier_t29',
        observations: [
          { assertion_id: 'docx_reopens', passed: editedDocxCheck.reopened, detail: 'independent read path' },
          { assertion_id: 'sections_present', passed: editedDocxCheck.reason === null, detail: 'all expected sections found' },
        ] }),
      resultOf({ check_id: 'render_inspected', definition: checks[2]!, observer_id: 'document_verifier_t29',
        observations: [
          { assertion_id: 'no_blank_pages', passed: goodRender.blank_pages.length === 0, detail: `${String(goodRender.pages.length)} pages inspected` },
          { assertion_id: 'expected_text_present', passed: goodRender.missing_text.length === 0, detail: 'expected text found in the rendered output' },
        ] }),
    ];
    const evidence = buildDocumentEvidence({
      project_id: PROJECT, job_id: job.job_id, attempt_id: attemptRecord.attempt_id,
      instruction_revision: 1, issuer_id: 'document_verifier_t29', scope_digest: scope.scope_digest,
      source_manifest_digest, output_manifest_digest, policy_digest: policy.policy_digest, pipeline_digest,
      results, integrity_passed: true, blocking_findings: [],
      started_at: '2026-09-09T10:00:00.000Z', finished_at: '2026-09-09T10:00:05.000Z',
    });
    const envelope = signer.sealDocument(evidence, 'document_verifier');
    const expected = {
      project_id: PROJECT, job_id: job.job_id, attempt_id: attemptRecord.attempt_id,
      instruction_revision: 1, scope_digest: scope.scope_digest, source_manifest_digest,
      output_manifest_digest, pipeline_digest,
    };
    const verdict = decideDocumentReadiness({ policy, envelope, trust, now: '2026-09-09T10:01:00.000Z', expected });

    // The forgeries a worker would try.
    const workerSeal = attempt(() => signer.sealDocument(evidence, 'worker'));
    const softwareEvaluatorRefuses = openEnvelope({ envelope, trust, now: '2026-09-09T10:01:00.000Z' });
    const forged = [
      ['claimed pass without observations', { ...evidence, results: results.map(result => ({ ...result, tests_total: 0, tests_passed: 0 })) }],
      ['required check missing', { ...evidence, results: results.slice(0, 2) }],
      ['blocking finding present', { ...evidence, blocking_findings: ['clipped page 2'] }],
      ['output bytes changed after the checks', { ...evidence, output_manifest_digest: digest({ tampered: true }) }],
      ['stale source manifest', { ...evidence, source_manifest_digest: digest({ old: true }) }],
      ['wrong instruction revision', { ...evidence, instruction_revision: 2 }],
      ['different attempt', { ...evidence, attempt_id: 'datt_someone_else' }],
    ] as const;
    const forgedVerdicts = forged.map(([label, mutated]) => ({
      label,
      verdict: decideDocumentReadiness({
        policy, envelope: signer.sealDocument(mutated as typeof evidence, 'document_verifier'),
        trust, now: '2026-09-09T10:01:00.000Z', expected,
      }),
    }));
    // From PROCESSING the transition is not even legal; from VERIFYING it is, and the role
    // check is what refuses it. Both are exercised, because only the second one isolates the
    // control that matters.
    const workerReadyFromProcessing = attempt(() => jobs.transition({
      job_id: job.job_id, expected_version: jobs.get(job.job_id).state_version, target: 'READY',
      actor: 'worker', reason: 'my edit looks fine', idempotency_key: 'worker-ready', result_id: 'dres_forged',
    }));

    jobs.transition({ job_id: job.job_id, expected_version: jobs.get(job.job_id).state_version, target: 'VERIFYING', actor: 'controller', reason: 'document QA', idempotency_key: 'verify-t29' });
    const workerReady = attempt(() => jobs.transition({
      job_id: job.job_id, expected_version: jobs.get(job.job_id).state_version, target: 'READY',
      actor: 'worker', reason: 'my edit looks fine', idempotency_key: 'worker-ready-2', result_id: 'dres_forged',
    }));
    const verifierWithoutResult = attempt(() => jobs.transition({
      job_id: job.job_id, expected_version: jobs.get(job.job_id).state_version, target: 'READY',
      actor: 'document_verifier', reason: 'no result recorded', idempotency_key: 'ready-no-result',
    }));
    const result: DocumentResult = {
      kind: 'document_result', schema_version: 1, result_id: `dres_${job.job_id}`,
      job_id: job.job_id, project_id: PROJECT, instruction_revision: 1,
      source_scope_digest: scope.scope_digest, source_version_ids: [docxVersion.version.version_id],
      coverage: 'COMPLETE', limitations: [], calculation_status: 'NOT_APPLICABLE',
      qa_evidence_ref: evidence.evidence_id, artifacts, created_at: NOW,
    };
    jobs.recordResult(result);
    const readyJob = verdict.verdict === 'READY_FOR_SCOPE'
      ? jobs.transition({ job_id: job.job_id, expected_version: jobs.get(job.job_id).state_version, target: 'READY', actor: 'document_verifier', reason: 'document QA passed', idempotency_key: 'ready-t29', result_id: result.result_id })
      : null;
    const cannotForge = verdict.verdict === 'READY_FOR_SCOPE' &&
      !workerSeal.ok && workerSeal.message.includes('ACTOR_CANNOT_SIGN_DOCUMENT_EVIDENCE') &&
      !softwareEvaluatorRefuses.opened && softwareEvaluatorRefuses.reasons.includes('NOT_EVIDENCE') &&
      forgedVerdicts.every(entry => entry.verdict.verdict === 'UNVERIFIED') &&
      !workerReadyFromProcessing.ok && workerReadyFromProcessing.message.includes('ILLEGAL_TRANSITION') &&
      !workerReady.ok && workerReady.message.includes('READY_REQUIRES_DOCUMENT_VERIFIER') &&
      !verifierWithoutResult.ok && verifierWithoutResult.message.includes('READY_REQUIRES_RESULT') &&
      !workerPolicy.ok && readyJob?.state === 'READY';

    // ---- 6. Download matches the verified digest --------------------------------------------
    const download = prepareDownload({ artifact: artifacts[0]!, bytes: edited.output_bytes, requested_name: '../../etc/Operations Manual.docx' });
    const tampered = prepareDownload({ artifact: artifacts[0]!, bytes: Buffer.concat([edited.output_bytes, Buffer.from('x')]), requested_name: 'manual.docx' });
    const htmlPreview = prepareDownload({
      artifact: { ...artifacts[0]!, media_type: 'text/html' }, bytes: edited.output_bytes, requested_name: 'preview.html',
    });
    const downloadMatches = download.allowed && download.filename === 'Operations_Manual.docx' &&
      download.headers['x-content-digest'] === artifacts[0]!.content_digest &&
      (download.headers['content-disposition'] ?? '').startsWith('attachment;') &&
      !tampered.allowed && !htmlPreview.allowed &&
      artifacts[0]!.content_digest === digestOf(edited.output_bytes);

    await writer.write('editing.json', {
      original_digest: originalDigest, on_disk_after: onDiskAfter, stored_after: storedAfter,
      edit: { output_digest: edited.output_digest, applied: edited.applied, meaning: edited.meaning, preserved_parts: edited.preserved_parts },
      forbidden_edit: forbidden.meaning,
      reopen: { docx: editedDocxCheck, xlsx: workbookCheck, pptx: deckCheck, chart_still_editable: chartStillEditable },
      recalculated: recalculated.cells[0],
      render: { good: goodRender, clipped: clippedRender },
      download: { allowed: download, tampered, html_preview: htmlPreview },
    } as unknown as Json);
    await writer.write('documentation.json', {
      documented_example: documented, corrected_example: observed, correction: corrected.applied,
      recheck, corrected_text: corrected.text,
    } as unknown as Json);
    await writer.write('document-qa.json', {
      policy, evidence, verdict, expected,
      forged: forgedVerdicts.map(entry => ({ label: entry.label, verdict: entry.verdict.verdict, reasons: entry.verdict.verdict === 'UNVERIFIED' ? entry.verdict.reasons : [] })),
      worker_seal: workerSeal, worker_policy: workerPolicy,
      worker_ready_from_processing: workerReadyFromProcessing, worker_ready_from_verifying: workerReady,
      verifier_without_result: verifierWithoutResult,
      software_evaluator: softwareEvaluatorRefuses,
      job_state: jobs.get(job.job_id).state, events: jobs.events(job.job_id),
    } as unknown as Json);

    return {
      scenario_id: 'AT-029',
      mode: 'integration',
      observed: {
        original_bytes_unchanged: originalsUnchanged,
        requested_editable_outputs_reopen: outputsReopen,
        business_meaning_preserved: meaningPreserved,
        api_examples_executed_against_target_version: examplesExecuted,
        rendered_layout_failures_caught: renderCaught,
        worker_cannot_forge_document_ready: cannotForge,
        artifact_download_matches_verified_digest: downloadMatches,
        forged_evidence_refused: forgedVerdicts.length,
        rendered_pages: goodRender.pages.length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    for (const entry of running) await entry.stop().catch(() => undefined);
    documentAuthority.close();
    policyStore.close();
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
