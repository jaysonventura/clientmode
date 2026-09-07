/** AT-007 executor.
 *
 * Every mutation case from tests/reference.test.mjs is replayed against the product boundary
 * with real Ed25519 keys, and the sandbox attacks are real processes: the worker tries to read
 * the signing key on disk and to write the evidence store, and is refused by the kernel.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Candidate, ClientRequest, Contract, Evidence, Json, Policy, ScenarioObservation, Verdict } from '../../contracts/interfaces.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService, type Guard } from '../../packages/core/src/lifecycle.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { EvidenceSigner, TrustStore } from '../../packages/verifier/src/evidence.js';
import { decideReadiness } from '../../packages/verifier/src/verdict.js';
import { execute } from '../../packages/verifier/src/executor.js';
import { attest, checkPromotable } from '../../packages/release/src/attestation.js';
import { compositeManifestDigest, type ComponentObservation } from '../../packages/verification-targets/src/composite.js';
import type { TargetResolution } from '../../packages/verification-targets/src/resolve.js';
import { Evidence as EvidenceWriter, ROOT, attempt, attemptAsync, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const NOW = '2026-09-07T00:02:00Z';
const ISSUER = 'verifier_fixture';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples', `${name}.json`), 'utf8')) as T;
}

type Mutation = [string, (evidence: Record<string, unknown>) => void];
type ContextMutation = [string, (input: { candidate: Candidate; policy: Policy; envelope: { issuer_id: string; algorithm: string; payload_base64: string; signature_base64: string }; now: string; expectedAttemptId?: string | undefined; revokeIssuer?: boolean | undefined }) => void];

/** The evidence mutations from the executable reference contract, replayed here. */
const EVIDENCE_MUTATIONS: Mutation[] = [
  ['missing evidence identity', e => { delete e['evidence_id']; }],
  ['missing required result', e => { (e['results'] as unknown[]).pop(); }],
  ['failed result', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['status'] = 'FAILED'; }],
  ['nonzero exit', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['exit_code'] = 1; }],
  ['timeout', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['status'] = 'TIMEOUT'; }],
  ['skipped status', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['status'] = 'SKIPPED'; }],
  ['not executed', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['executed'] = false; }],
  ['zero tests', e => { const r = (e['results'] as Array<Record<string, unknown>>)[0]!; r['tests_total'] = 0; r['tests_passed'] = 0; }],
  ['reduced test discovery', e => { const r = (e['results'] as Array<Record<string, unknown>>)[0]!; r['tests_total'] = 2; r['tests_passed'] = 2; }],
  ['skipped test', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['tests_skipped'] = 1; }],
  ['incomplete passing count', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['tests_passed'] = 1; }],
  ['negative count', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['tests_total'] = -1; }],
  ['missing assertion', e => { ((e['results'] as Array<Record<string, unknown>>)[0]!['assertion_ids'] as string[]).pop(); }],
  ['duplicate assertion', e => { ((e['results'] as Array<Record<string, unknown>>)[0]!['assertion_ids'] as string[]).push('idempotency'); }],
  ['duplicate result', e => { const r = e['results'] as Array<Record<string, unknown>>; r.push(r[0]!); }],
  ['unknown result', e => { const r = e['results'] as Array<Record<string, unknown>>; r.push({ ...r[0]!, check_id: 'fake-extra' }); }],
  ['changed check definition', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['definition_digest'] = `sha256:${'9'.repeat(64)}`; }],
  ['missing observer', e => { delete (e['results'] as Array<Record<string, unknown>>)[0]!['observer_id']; }],
  ['invalid log hash', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['log_digest'] = 'PASS'; }],
  ['changed source', e => { e['source_digest'] = `sha256:${'9'.repeat(64)}`; }],
  ['changed artifact', e => { e['artifact_digest'] = `sha256:${'9'.repeat(64)}`; }],
  ['changed environment', e => { e['environment_digest'] = `sha256:${'9'.repeat(64)}`; }],
  ['changed policy', e => { e['policy_digest'] = `sha256:${'9'.repeat(64)}`; }],
  ['wrong project', e => { e['project_id'] = 'other_project'; }],
  ['wrong run', e => { e['run_id'] = 'other_run'; }],
  ['wrong candidate', e => { e['candidate_id'] = 'other_candidate'; }],
  ['expired attempt', e => { e['attempt_id'] = 'old_attempt'; }],
  ['requirement change', e => { e['requirements_revision'] = 2; }],
  ['issuer substitution', e => { e['issuer_id'] = 'model'; }],
  ['source changed during verification', e => { e['integrity_passed'] = false; }],
  ['blocking review finding', e => { e['blocking_findings'] = ['authorization defect']; }],
  ['missing blocking finding field', e => { delete e['blocking_findings']; }],
  ['future finish', e => { e['finished_at'] = '2026-09-07T00:03:00Z'; }],
  ['invalid timestamp', e => { e['finished_at'] = 'tomorrow'; }],
  ['finish before start', e => { e['finished_at'] = '2026-09-06T23:59:00Z'; }],
  ['evidence before candidate', e => { e['started_at'] = '2026-09-06T23:59:00Z'; }],
  ['missing results', e => { delete e['results']; }],
  ['string count', e => { (e['results'] as Array<Record<string, unknown>>)[0]!['tests_total'] = '3'; }],
  ['unsupported evidence schema', e => { e['schema_version'] = 2; }],
  ['fake PASS text instead of counts', e => { e['results'] = [{ check_id: 'api-order', status: 'PASS' }]; }],
  ['date-only timestamps', e => { e['started_at'] = '2026-09-07'; e['finished_at'] = '2026-09-07'; }],
];

const CONTEXT_MUTATIONS: ContextMutation[] = [
  ['expired evidence', input => { input.now = '2026-09-09T00:00:00Z'; }],
  ['advisory policy', input => { input.policy.authority = 'advisory'; }],
  ['empty policy', input => { input.policy.checks = []; }],
  ['all optional policy', input => { input.policy.checks.forEach(check => { check.required = false; }); }],
  ['duplicate definition', input => { input.policy.checks.push(input.policy.checks[0]!); }],
  ['zero-test behavioral policy', input => { input.policy.checks[0]!.minimum_tests = 0; }],
  ['revoked key', input => { input.revokeIssuer = true; }],
  ['unknown issuer', input => { input.envelope.issuer_id = 'unknown'; }],
  ['missing trusted attempt', input => { delete input.expectedAttemptId; }],
  ['unapproved policy issuer', input => { input.policy.trusted_issuer_ids = []; }],
  ['wrong policy revision', input => { input.policy.requirements_revision = 2; }],
  ['unsupported signature algorithm', input => { input.envelope.algorithm = 'none'; }],
  ['malformed base64', input => { input.envelope.payload_base64 = 'invalid$$'; }],
  ['oversized envelope', input => { input.envelope.payload_base64 = 'a'.repeat(1_400_004); }],
  ['payload altered after signing', input => {
    const forged = fixture<Record<string, unknown>>('evidence');
    forged['project_id'] = 'forged';
    input.envelope.payload_base64 = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64');
  }],
  ['signature replaced', input => { input.envelope.signature_base64 = Buffer.alloc(64).toString('base64'); }],
  ['wrong candidate policy binding', input => { input.candidate.policy_digest = `sha256:${'7'.repeat(64)}`; }],
];

registerScenario('AT-007', async (): Promise<ScenarioObservation> => {
  const writer = await EvidenceWriter.open('T07');
  const clock = fixedClock('2026-09-07T00:02:00.000Z');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t07-'));
  const authorityDir = path.join(sandbox, 'verifier-authority');
  const store = ProtectedPolicyStore.open(authorityDir);
  const trust = new TrustStore(store);
  const signer = EvidenceSigner.open({ authority_dir: authorityDir, issuer_id: ISSUER, trust, now: '2026-09-06T00:00:00Z' });
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));
  const log: Record<string, unknown> = {};

  try {
    const candidate = fixture<Candidate>('candidate');
    const policy = fixture<Policy>('policy');
    const evidence = fixture<Evidence>('evidence');

    // 1. A clean, current, authentically signed candidate is verified for scope.
    const cleanVerdict = decideReadiness({
      candidate, policy, envelope: signer.seal(evidence, 'verifier'), trust,
      now: NOW, expectedAttemptId: 'attempt_01',
    });
    log['clean'] = cleanVerdict;
    const cleanVerified = cleanVerdict.verdict === 'VERIFIED_FOR_SCOPE' &&
      cleanVerdict.candidate_id === 'candidate_01' && cleanVerdict.evidence_id === 'evidence_01' &&
      !Object.hasOwn(cleanVerdict, 'production_ready');

    // 2. Every reference mutation, replayed against the product boundary.
    const evidenceOutcomes = EVIDENCE_MUTATIONS.map(([name, mutate]) => {
      const mutated = fixture<Record<string, unknown>>('evidence');
      mutate(mutated);
      let envelope: unknown;
      try {
        envelope = signer.seal(mutated as unknown as Evidence, 'verifier');
      } catch {
        // A payload the signer itself refuses is already a rejection; record the raw envelope
        // form so the readiness predicate is still exercised on it.
        const payload = Buffer.from(JSON.stringify(mutated), 'utf8');
        envelope = { kind: 'signed_envelope', schema_version: 1, issuer_id: ISSUER, algorithm: 'Ed25519', payload_base64: payload.toString('base64'), signature_base64: Buffer.alloc(64).toString('base64') };
      }
      const verdict = decideReadiness({
        candidate: fixture<Candidate>('candidate'), policy: fixture<Policy>('policy'),
        envelope, trust, now: NOW, expectedAttemptId: 'attempt_01',
      });
      return { name, verdict: verdict.verdict, reasons: verdict.reasons.slice(0, 4) };
    });

    const contextOutcomes = CONTEXT_MUTATIONS.map(([name, mutate]) => {
      const input = {
        candidate: fixture<Candidate>('candidate'), policy: fixture<Policy>('policy'),
        envelope: signer.seal(fixture<Evidence>('evidence'), 'verifier') as unknown as { issuer_id: string; algorithm: string; payload_base64: string; signature_base64: string },
        now: NOW, expectedAttemptId: 'attempt_01' as string | undefined, revokeIssuer: false,
      };
      mutate(input);
      if (input.revokeIssuer === true) trust.revoke(ISSUER, '2026-09-06T12:00:00Z');
      const verdict = decideReadiness({
        candidate: input.candidate, policy: input.policy, envelope: input.envelope, trust,
        now: input.now, expectedAttemptId: input.expectedAttemptId ?? '',
      });
      if (input.revokeIssuer === true) {
        trust.register({ issuer_id: ISSUER, public_key_pem: currentPublicKeyPem(store), not_before: '2026-09-06T00:00:00Z' });
      }
      return { name, verdict: verdict.verdict, reasons: verdict.reasons.slice(0, 4) };
    });

    const allOutcomes = [...evidenceOutcomes, ...contextOutcomes];
    const malformedInputs = [undefined, null, {}, [], { candidate: 'done' }].map(value => ({
      name: `top-level ${JSON.stringify(value) ?? 'undefined'}`,
      verdict: decideReadiness(value as never).verdict, reasons: [] as string[],
    }));
    log['mutations'] = { evidence: evidenceOutcomes, context: contextOutcomes, malformed: malformedInputs };
    const staleOrForgedRejected = [...allOutcomes, ...malformedInputs].every(outcome => outcome.verdict === 'UNVERIFIED');
    const missingOrSkippedRejected = ['missing required result', 'skipped status', 'skipped test', 'zero tests', 'reduced test discovery', 'not executed', 'fake PASS text instead of counts']
      .every(name => evidenceOutcomes.find(outcome => outcome.name === name)?.verdict === 'UNVERIFIED');

    // 3. An implementation token cannot write ready state, and cannot sign.
    const readiness = new Map<string, Verdict>();
    const evidenceGuard: Guard = ({ run }) => readiness.get(run.run_id)?.verdict === 'VERIFIED_FOR_SCOPE';
    const service = new LifecycleService(db, { clock, guards: { current_authenticated_evidence: evidenceGuard } });
    service.registerProject({ project_id: 'project_shop', registered_root_ref: `file://${sandbox}/work`, profile_id: 'discover', data_class: 'internal' });
    const request = fixture<ClientRequest>('request');
    const run = await service.createRun(request, 'idem-t07');
    const contract = fixture<Contract>('contract');
    service.recordContract(contract);
    await service.transition({
      run_id: run.run_id, expected_version: 1, target: 'SCOPED', actor: 'controller',
      reason: 'scoped', guard_evidence_ids: [], idempotency_key: 'scope-t07',
      bind: { contract_id: contract.contract_id, requirements_revision: contract.revision },
    });
    // Move the run into VERIFYING through its real transitions, so the readiness guard —
    // not an illegal transition — is what the next two attempts run into.
    const scopedRun = await service.getRun(run.run_id);
    service.createAttempt({
      attempt_id: 'attempt_t07', project_id: 'project_shop', run_id: run.run_id, task_id: 'task_t07',
      attempt_number: 1, role: 'writer', parent_attempt_id: null, depth: 0, workspace_id: 'ws_t07',
      base_source_digest: candidate.source_digest, allowed_write_paths: ['src/'], dependency_task_ids: [],
      deadline: '2026-09-08T00:00:00.000Z', provider_session_id: null,
    });
    db.run('INSERT INTO budget_reservations (reservation_id, run_id, attempt_id, reserved_microusd, reserved_tokens, verification_reserve, status, created_at) VALUES (?,?,?,?,NULL,0,?,?)',
      'res_t07', run.run_id, 'attempt_t07', 1_000_000, 'RESERVED', clock());
    const running = await service.transition({
      run_id: run.run_id, expected_version: scopedRun.state_version, target: 'RUNNING', actor: 'controller',
      reason: 'authorized and budgeted', guard_evidence_ids: [], idempotency_key: 'running-t07',
    });
    db.run('INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest, requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      'candidate_t07', 'project_shop', run.run_id, candidate.source_digest, candidate.artifact_digest, 1, candidate.policy_digest, candidate.environment_digest, clock());
    const verifyingRun = await service.transition({
      run_id: run.run_id, expected_version: running.state_version, target: 'VERIFYING', actor: 'controller',
      reason: 'candidate sealed', guard_evidence_ids: [], idempotency_key: 'verifying-t07',
      bind: { candidate_id: 'candidate_t07' },
    });
    const scoped = verifyingRun;
    const workerReady = await attemptAsync(() => service.transition({
      run_id: run.run_id, expected_version: scoped.state_version, target: 'READY_FOR_REVIEW',
      actor: 'worker', reason: 'my tests passed', guard_evidence_ids: ['self-asserted'], idempotency_key: 'worker-ready',
    }));
    // Even the verifier cannot reach ready without a derived verdict for this run.
    const verifierWithoutEvidence = await attemptAsync(() => service.transition({
      run_id: run.run_id, expected_version: scoped.state_version, target: 'READY_FOR_REVIEW',
      actor: 'verifier', reason: 'claimed', guard_evidence_ids: ['forged'], idempotency_key: 'no-evidence-ready',
    }));
    const workerSigning = attempt(() => signer.seal(evidence, 'worker'));

    // The worker also tries, as a real process, to read the signing key and write the store.
    const workerWorkspace = path.join(sandbox, 'worker');
    const keyFile = path.join(authorityDir, `${ISSUER}.ed25519.key`);
    const stealKey = await execute({
      argv: [process.execPath, '-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(keyFile)}, 'utf8'))`],
      cwd: sandbox, sandbox_root: path.join(sandbox, 'steal-sandbox'),
      timeout_seconds: 15, maximum_output_bytes: 65536, network_profile_id: 'deny',
      environment: {
        profile_id: 'worker', required_platform: null, required_executables: ['node'],
        denied_read_paths: [authorityDir], allowed_write_paths: [workerWorkspace],
        allow_home_read: false, toolchain_paths: [path.dirname(process.execPath)],
        description: 'Implementation worker sandbox.',
      },
      observer_id: 'verifier_t07', now: clock,
    });
    log['authority'] = {
      worker_transition: workerReady, verifier_without_verdict: verifierWithoutEvidence,
      worker_signing: workerSigning,
      key_theft_exit: stealKey.exit_code, key_theft_stderr: stealKey.stderr.slice(0, 200),
      key_material_leaked: stealKey.stdout.includes('PRIVATE KEY'),
      key_file_mode: '0600 at creation',
    };
    const workerReadyDenied = !workerReady.ok && workerReady.code === 'ACTOR_NOT_AUTHORITATIVE' &&
      !verifierWithoutEvidence.ok && verifierWithoutEvidence.code === 'GUARD_NOT_SATISFIED';
    const workerSigningDenied = !workerSigning.ok && workerSigning.code === 'ACTOR_CANNOT_SIGN_EVIDENCE' &&
      stealKey.exit_code !== 0 && !stealKey.stdout.includes('PRIVATE KEY');

    // With a real verdict recorded by the verification side, the verifier can transition.
    readiness.set(run.run_id, cleanVerdict);
    const verifying = await service.getRun(run.run_id);
    const verifierReady = await attemptAsync(() => service.transition({
      run_id: run.run_id, expected_version: verifying.state_version, target: 'READY_FOR_REVIEW',
      actor: 'verifier', reason: 'authenticated evidence', guard_evidence_ids: ['evidence_01'], idempotency_key: 'ready-t07',
    }));
    log['authority_positive'] = { state_before: verifying.state, verifier_ready: verifierReady.ok ? 'COMMITTED' : verifierReady };

    // 4. Composite candidate: web-only evidence against a contract that also requires a
    //    native component and a model evaluation.
    const requirements: TargetResolution[] = [
      { component_id: 'shop-web', target: 'web', required_tools: ['node'], evidence_must_be: 'browser journeys', available: true, missing: [], detail: '' },
      { component_id: 'pricing-native', target: 'native-macos', required_tools: ['swiftc'], evidence_must_be: 'compiled binary behaviour', available: true, missing: [], detail: '' },
      { component_id: 'retrieval-model', target: 'model', required_tools: [], evidence_must_be: 'scored evaluation', available: true, missing: [], detail: '' },
    ];
    const webOnly: ComponentObservation[] = [
      { component_id: 'shop-web', observed_target: 'web', status: 'PASSED', evidence_ref: 'browser', detail: 'journey passed' },
    ];
    const components = [
      { component_id: 'shop-web', artifact_digest: `sha256:${'a'.repeat(64)}`, interface_version: 'http/1' },
      { component_id: 'pricing-native', artifact_digest: `sha256:${'b'.repeat(64)}`, interface_version: 'stdio/1' },
      { component_id: 'retrieval-model', artifact_digest: `sha256:${'c'.repeat(64)}`, interface_version: 'eval/1' },
    ];
    const manifest = compositeManifestDigest({ candidate_id: candidate.candidate_id, components });
    const partial = decideReadiness({
      candidate, policy, envelope: signer.seal(evidence, 'verifier'), trust, now: NOW, expectedAttemptId: 'attempt_01',
      composite: { requirements, observations: webOnly, manifest_digest: manifest, evidence_manifest_digest: manifest },
    });
    log['partial_polyglot'] = partial;
    const partialRejected = partial.verdict === 'UNVERIFIED' &&
      partial.reasons.some(reason => reason.includes('pricing-native')) &&
      partial.reasons.some(reason => reason.includes('retrieval-model'));

    // 5. Changing the native binary or the model revision invalidates the evidence.
    const complete: ComponentObservation[] = [
      ...webOnly,
      { component_id: 'pricing-native', observed_target: 'native-macos', status: 'PASSED', evidence_ref: 'swift', detail: 'binary interacted' },
      { component_id: 'retrieval-model', observed_target: 'model', status: 'PASSED', evidence_ref: 'eval', detail: 'grounding passed' },
    ];
    const completeVerdict = decideReadiness({
      candidate, policy, envelope: signer.seal(evidence, 'verifier'), trust, now: NOW, expectedAttemptId: 'attempt_01',
      composite: { requirements, observations: complete, manifest_digest: manifest, evidence_manifest_digest: manifest },
    });
    const changedNative = compositeManifestDigest({
      candidate_id: candidate.candidate_id,
      components: components.map(entry => entry.component_id === 'pricing-native' ? { ...entry, artifact_digest: `sha256:${'d'.repeat(64)}` } : entry),
    });
    const changedModel = compositeManifestDigest({
      candidate_id: candidate.candidate_id,
      components: components.map(entry => entry.component_id === 'retrieval-model' ? { ...entry, artifact_digest: `sha256:${'e'.repeat(64)}` } : entry),
    });
    const afterNativeChange = decideReadiness({
      candidate, policy, envelope: signer.seal(evidence, 'verifier'), trust, now: NOW, expectedAttemptId: 'attempt_01',
      composite: { requirements, observations: complete, manifest_digest: changedNative, evidence_manifest_digest: manifest },
    });
    const afterModelChange = decideReadiness({
      candidate, policy, envelope: signer.seal(evidence, 'verifier'), trust, now: NOW, expectedAttemptId: 'attempt_01',
      composite: { requirements, observations: complete, manifest_digest: changedModel, evidence_manifest_digest: manifest },
    });

    // The attestation is what release consults, and it refuses a rebuilt artifact.
    const attestation = attest({ candidate, verdict: cleanVerdict, issuer_id: ISSUER, issued_at: NOW, composite_manifest_digest: manifest });
    const promotable = checkPromotable({
      attestation, artifact_digest_to_promote: candidate.artifact_digest,
      current_policy_digest: candidate.policy_digest, current_requirements_revision: 1,
      current_composite_manifest_digest: manifest, target_environment: 'staging', approved_environment: 'staging',
    });
    const rebuilt = checkPromotable({
      attestation, artifact_digest_to_promote: `sha256:${'f'.repeat(64)}`,
      current_policy_digest: candidate.policy_digest, current_requirements_revision: 1,
      current_composite_manifest_digest: changedNative, target_environment: 'production', approved_environment: 'staging',
    });
    log['composite_identity'] = {
      complete: completeVerdict, after_native_change: afterNativeChange, after_model_change: afterModelChange,
      attestation, promotable, rebuilt,
    };
    const changedComponentInvalidates =
      completeVerdict.verdict === 'VERIFIED_FOR_SCOPE' &&
      afterNativeChange.verdict === 'UNVERIFIED' && afterNativeChange.reasons.includes('COMPOSITE_MANIFEST_CHANGED') &&
      afterModelChange.verdict === 'UNVERIFIED' && afterModelChange.reasons.includes('COMPOSITE_MANIFEST_CHANGED') &&
      promotable.promotable && !rebuilt.promotable &&
      rebuilt.reasons.includes('ARTIFACT_DIGEST_CHANGED') && rebuilt.reasons.includes('ENVIRONMENT_NOT_APPROVED');

    await writer.write('readiness.json', log);
    await writer.write('mutation-verdicts.json', allOutcomes);
    await writer.write('authority-directory.json', { files: readdirSync(authorityDir) });

    return {
      scenario_id: 'AT-007',
      mode: 'integration',
      observed: {
        clean_candidate_verified: cleanVerified,
        stale_or_forged_evidence_rejected: staleOrForgedRejected,
        missing_or_skipped_checks_rejected: missingOrSkippedRejected,
        worker_ready_write_denied: workerReadyDenied,
        worker_signing_denied: workerSigningDenied,
        partial_polyglot_evidence_rejected: partialRejected,
        changed_native_or_model_artifact_invalidates_evidence: changedComponentInvalidates,
        mutations_executed: allOutcomes.length + malformedInputs.length,
        verifier_ready_with_real_verdict: verifierReady.ok,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    db.close();
    store.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});

/** Read back the registered public key so a revocation case can restore it afterwards. */
function currentPublicKeyPem(store: ProtectedPolicyStore): string {
  const row = store.raw().prepare('SELECT public_key_pem FROM issuer_public_keys WHERE issuer_id = ?').get(ISSUER) as Record<string, unknown>;
  return String(row['public_key_pem']);
}
