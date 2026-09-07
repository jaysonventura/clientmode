/** AT-001 executor. Every observation is the recorded outcome of a real operation. */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { compareInterfaceShapes } from '../harness/shape-parity.js';
import { exerciseScenario, registerScenario } from '../harness/registry.js';

const run = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const EXAMPLES = path.join(ROOT, 'contracts/examples');
const EVIDENCE = path.join(ROOT, 'qa/product/T01');

type Case = { name: string; valid: boolean; errors: string[] };

async function example(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(EXAMPLES, `${name}.json`), 'utf8')) as Record<string, unknown>;
}

/** Record the real validator outcome for one mutated entity. */
function check(log: Case[], name: string, entity: unknown): boolean {
  const result = validateEntity(entity);
  log.push({ name, valid: result.valid, errors: result.errors });
  return result.valid;
}

/** Prove the validator dependency cannot be absent and still report success. */
async function validatorAbsenceProbe(entity: unknown): Promise<{ exit_code: number; stdout: string; stderr: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cm-t01-'));
  try {
    const probe = path.join(dir, 'probe.mjs');
    await writeFile(probe, `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (/(^|\\/)ajv(-formats)?(\\/|$)/.test(specifier)) {
    const error = new Error('BLOCKED_VALIDATOR_DEPENDENCY:' + specifier);
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
  }
  return nextResolve(specifier, context);
} });
const module = await import(process.argv[2]);
const result = module.validateEntity(JSON.parse(process.argv[3]));
console.log(JSON.stringify(result));
process.exit(result.valid ? 0 : 3);
`);
    const target = path.join(ROOT, 'packages/contracts/src/validate.ts');
    try {
      const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', probe, target, JSON.stringify(entity)], { cwd: ROOT });
      return { exit_code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { exit_code: typeof failure.code === 'number' ? failure.code : 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

registerScenario('AT-001', async (): Promise<ScenarioObservation> => {
  const accepted: Case[] = [];
  const rejected: Case[] = [];

  // 1. Every supplied example must validate against its domain schema.
  const files = (await readdir(EXAMPLES)).filter(name => name.endsWith('.json')).sort();
  for (const file of files) {
    const entity: unknown = JSON.parse(await readFile(path.join(EXAMPLES, file), 'utf8'));
    check(accepted, file, entity);
  }
  const validExamplesAccepted = files.length > 0 && accepted.every(entry => entry.valid);

  // 2. Malformed candidates: missing digest, unknown field, non-positive revision.
  const base = await example('candidate');
  const missing = { ...base };
  delete missing['artifact_digest'];
  const malformed: Array<[string, unknown]> = [
    ['candidate.missing_artifact_digest', missing],
    ['candidate.unknown_field', { ...base, unexpected_field: 'x' }],
    ['candidate.negative_requirements_revision', { ...base, requirements_revision: -1 }],
  ];
  let malformedRejected = 0;
  for (const [name, entity] of malformed) if (!check(rejected, name, entity)) malformedRejected += 1;

  // 3. An unregistered scenario ID must be refused by the shared harness.
  let unknownScenarioRejected = false;
  try {
    await exerciseScenario('AT-000-NEVER-REGISTERED');
  } catch (error) {
    unknownScenarioRejected = (error as Error).message === 'UNREGISTERED_SCENARIO:AT-000-NEVER-REGISTERED';
  }

  // 4. Open-ended engineering context: polyglot and unfamiliar non-JS stacks.
  const context = await example('engineering-context');
  const components = context['components'] as Array<Record<string, unknown>>;
  const languages = components.map(component => (component['languages'] as string[]).join('+'));
  const unfamiliar = structuredClone(context);
  const firstUnfamiliar = (unfamiliar['components'] as Array<Record<string, unknown>>)[0]!;
  firstUnfamiliar['languages'] = ['UnfamiliarFixtureLanguage'];
  firstUnfamiliar['frameworks'] = ['FixtureFramework'];
  firstUnfamiliar['domain'] = 'custom-dsl';
  firstUnfamiliar['target_platforms'] = ['FixtureHardwareTarget'];
  const csharpOnly = structuredClone(context);
  const csharp = (csharpOnly['components'] as Array<Record<string, unknown>>)[0]!;
  csharp['languages'] = ['C#'];
  csharp['frameworks'] = ['.NET'];
  csharp['target_platforms'] = ['Windows'];
  csharpOnly['components'] = [csharp];
  const openEndedAccepted =
    languages.join(',') === 'Swift,Go,Python' &&
    check(accepted, 'engineering-context.polyglot', context) &&
    check(accepted, 'engineering-context.unfamiliar_language', unfamiliar) &&
    check(accepted, 'engineering-context.non_javascript_only', csharpOnly);

  // 5. Grounding claims without provenance, and blocks without a stated gap, are refused.
  const grounded = structuredClone(context);
  (grounded['components'] as Array<Record<string, unknown>>)[0]!['grounding_status'] = 'GROUNDED';
  (grounded['components'] as Array<Record<string, unknown>>)[0]!['source_refs'] = [];
  const blocked = structuredClone(context);
  (blocked['components'] as Array<Record<string, unknown>>)[0]!['grounding_status'] = 'BLOCKED';
  (blocked['components'] as Array<Record<string, unknown>>)[0]!['capability_gaps'] = [];
  const unsupportedGroundingRejected =
    !check(rejected, 'engineering-context.grounded_without_source_refs', grounded) &&
    !check(rejected, 'engineering-context.blocked_without_capability_gap', blocked);

  // 6. Conditional entity contracts reject internally inconsistent records.
  const [runEntity, approval, decision, policy, attempt] =
    await Promise.all([example('run'), example('approval'), example('approval-decision'), example('policy'), example('attempt')]);
  const inconsistent: Array<[string, unknown]> = [
    ['run.running_without_contract', { ...runEntity, contract_id: null, requirements_revision: 0, state: 'RUNNING' }],
    ['run.scoped_without_revision', { ...runEntity, requirements_revision: 0, state: 'SCOPED' }],
    ['run.ready_without_candidate', { ...runEntity, candidate_id: null, state: 'READY_FOR_REVIEW' }],
    ['approval.deploy_without_artifact', { ...approval, action: 'deploy', candidate_id: null, artifact_digest: null }],
    ['approval.spend_without_limit', { ...approval, action: 'api_spend', maximum_spend_usd: null }],
    ['approval_decision.approve_without_grant', { ...decision, decision: 'approve', approval: null }],
    ['approval_decision.deny_with_grant', { ...decision, decision: 'deny', approval }],
    ['policy.zero_minimum_tests', { ...policy, checks: (policy['checks'] as Array<Record<string, unknown>>).map((c, i) => (i === 0 ? { ...c, minimum_tests: 0 } : c)) }],
    ['policy.all_checks_optional', { ...policy, checks: (policy['checks'] as Array<Record<string, unknown>>).map(c => ({ ...c, required: false })) }],
    ['task_attempt.reviewer_with_write_scope', { ...attempt, role: 'reviewer', allowed_write_paths: ['src/'] }],
    ['task_attempt.root_claims_parent', { ...attempt, depth: 0, parent_attempt_id: 'parent_01' }],
    ['task_attempt.child_without_parent', { ...attempt, depth: 1, parent_attempt_id: null }],
  ];
  let conditionalRejected = 0;
  for (const [name, entity] of inconsistent) if (!check(rejected, name, entity)) conditionalRejected += 1;
  const precontractBlocked = check(accepted, 'run.precontract_blocked_is_representable',
    { ...runEntity, contract_id: null, requirements_revision: 0, candidate_id: null, state: 'BLOCKED' });
  const conditionalContractsReject = conditionalRejected === inconsistent.length && precontractBlocked;

  // 7. G0: an absent validator dependency must fail closed, never report a pass.
  const probe = await validatorAbsenceProbe(base);
  const validatorAbsenceFailsClosed = probe.exit_code !== 0 && !/"valid"\s*:\s*true/.test(probe.stdout);

  // Public TypeScript shapes must still match the schema they claim to mirror.
  const parity = compareInterfaceShapes();

  await mkdir(EVIDENCE, { recursive: true });
  const artifacts: string[] = [];
  const write = async (name: string, body: unknown) => {
    const file = path.join(EVIDENCE, name);
    await writeFile(file, JSON.stringify(body, null, 2) + '\n');
    artifacts.push(path.relative(ROOT, file));
  };
  await write('accepted.json', accepted);
  await write('rejected.json', rejected);
  await write('validator-absence-probe.json', probe);
  await write('interface-shape-parity.json', parity);

  return {
    scenario_id: 'AT-001',
    mode: 'unit',
    observed: {
      valid_examples_accepted: validExamplesAccepted,
      examples_validated: files.length,
      malformed_candidates_rejected: malformedRejected,
      unknown_scenario_rejected: unknownScenarioRejected,
      open_ended_engineering_context_accepted: openEndedAccepted,
      unsupported_grounding_claim_rejected: unsupportedGroundingRejected,
      conditional_contracts_reject_inconsistent_entities: conditionalContractsReject,
      required_validator_absence_fails_closed: validatorAbsenceFailsClosed,
      interface_shape_parity: parity.matched && parity.mismatches.length === 0,
    } satisfies Record<string, Json>,
    artifact_paths: artifacts,
  };
});
