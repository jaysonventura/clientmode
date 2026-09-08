/** AT-005 executor.
 *
 * The malicious fixture really tries to read a secret file, read a signing-key canary from
 * the environment, open a TCP connection, connect to a real unix socket and read the host
 * home directory. It reports only the accesses it was actually denied, so a weakened sandbox
 * makes the required assertion disappear and the check fails.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Candidate, CheckDefinition, Json, Policy, ScenarioObservation } from '../../contracts/interfaces.js';
import { digest } from '../../packages/contracts/src/canonical.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { snapshot } from '../../packages/workspace/src/snapshot.js';
import { ProtectedPolicyStore, type EnvironmentProfile } from '../../packages/verifier/src/policy.js';
import { VerificationCoordinator } from '../../packages/verifier/src/coordinator.js';
import { Evidence, attempt, attemptAsync, fixedClock } from '../harness/evidence.js';
import { auditPermissions } from '../../packages/verifier/src/file-permissions.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t05';
const NODE = process.execPath;
const NODE_DIR = path.dirname(NODE);

function write(root: string, relative: string, body: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function fixtures(workspace: string, secrets: { file: string; socket: string }): void {
  write(workspace, 'checks/passing.mjs', `console.log('TAP version 13');
console.log('ok 1 - shop_total');
console.log('ok 2 - guest_checkout');
console.log('1..2');
console.log('# tests 2');
console.log('# pass 2');
console.log('# fail 0');
console.log('# skipped 0');
`);

  write(workspace, 'checks/malicious.mjs', `import { readFileSync } from 'node:fs';
import net from 'node:net';
const denied = [];
const breached = [];
const probe = (id, action) => {
  try { const value = action(); if (value) breached.push(id); else denied.push(id); }
  catch { denied.push(id); }
};
probe('no_secret_access', () => readFileSync(${JSON.stringify(secrets.file)}, 'utf8').length > 0);
probe('no_env_secret', () => Boolean(process.env.CM_SIGNING_KEY));
probe('no_home_read', () => readFileSync(process.env.CM_HOST_HOME_PROBE ?? ${JSON.stringify(path.join(os.homedir(), '.zshrc'))}, 'utf8').length > 0);
const tcp = await new Promise(resolve => {
  const socket = net.connect(80, '1.1.1.1');
  const done = value => { try { socket.destroy(); } catch {} resolve(value); };
  socket.on('error', () => done(false));
  socket.on('connect', () => done(true));
  setTimeout(() => done(false), 2500);
});
(tcp ? breached : denied).push('no_network');
const unix = await new Promise(resolve => {
  const socket = net.connect(${JSON.stringify(secrets.socket)});
  const done = value => { try { socket.destroy(); } catch {} resolve(value); };
  socket.on('error', () => done(false));
  socket.on('connect', () => done(true));
  setTimeout(() => done(false), 2000);
});
(unix ? breached : denied).push('no_unix_socket');
console.log(JSON.stringify({ tests_total: 5, tests_passed: denied.length, tests_skipped: 0, assertion_ids: denied, breached }));
`);

  write(workspace, 'checks/hang-fork.mjs', `import { spawn } from 'node:child_process';
import path from 'node:path';
// The heartbeat lives in the workspace so it survives sandbox teardown and can be read
// after the deadline: a grandchild that outlived the kill would keep growing this file.
const heartbeat = path.join(process.cwd(), 'heartbeat.txt');
spawn(process.argv[0], ['-e', \`const fs=require('fs');setInterval(()=>{try{fs.appendFileSync(\${JSON.stringify(heartbeat)},'x')}catch{}},50)\`],
  { detached: false, stdio: 'ignore' });
console.log('forked a child that outlives its parent');
setInterval(() => {}, 1000);
`);

  write(workspace, 'checks/flood.mjs', `const line = 'x'.repeat(1024);
for (let index = 0; index < 20000; index += 1) console.log(line);
`);

  write(workspace, 'checks/silent.mjs', 'process.exit(0);\n');
  write(workspace, 'checks/malformed.mjs', "console.log('this is not a report');\nconsole.log('neither is this');\n");
  write(workspace, 'package.json', JSON.stringify({ name: 'verification-fixture', private: true }, null, 2) + '\n');
}

type CheckSpec = {
  check_id: string; required: boolean; result_kind: CheckDefinition['result_kind'];
  minimum_tests: number; required_assertion_ids: string[]; script: string;
  parser_id: string; parser_version: string; timeout_seconds: number;
  maximum_output_bytes: number; environment_profile_id: string;
};

const CHECKS: CheckSpec[] = [
  { check_id: 'unit-tests', required: true, result_kind: 'tests', minimum_tests: 2, required_assertion_ids: ['shop_total'], script: 'checks/passing.mjs', parser_id: 'tap13', parser_version: '1.0.0', timeout_seconds: 30, maximum_output_bytes: 262144, environment_profile_id: 'local-node' },
  { check_id: 'security-probe', required: true, result_kind: 'security', minimum_tests: 5, required_assertion_ids: ['no_secret_access', 'no_env_secret', 'no_home_read', 'no_network', 'no_unix_socket'], script: 'checks/malicious.mjs', parser_id: 'json_report', parser_version: '1.0.0', timeout_seconds: 30, maximum_output_bytes: 262144, environment_profile_id: 'local-node' },
  { check_id: 'ios-ui-journey', required: true, result_kind: 'process', minimum_tests: 0, required_assertion_ids: [], script: 'checks/passing.mjs', parser_id: 'process_exit', parser_version: '1.0.0', timeout_seconds: 30, maximum_output_bytes: 65536, environment_profile_id: 'ios-device' },
  { check_id: 'model-retrieval-eval', required: true, result_kind: 'process', minimum_tests: 0, required_assertion_ids: [], script: 'checks/passing.mjs', parser_id: 'process_exit', parser_version: '1.0.0', timeout_seconds: 30, maximum_output_bytes: 65536, environment_profile_id: 'model-eval' },
  { check_id: 'hang-and-fork', required: false, result_kind: 'process', minimum_tests: 0, required_assertion_ids: [], script: 'checks/hang-fork.mjs', parser_id: 'process_exit', parser_version: '1.0.0', timeout_seconds: 2, maximum_output_bytes: 65536, environment_profile_id: 'local-node' },
  { check_id: 'output-flood', required: false, result_kind: 'process', minimum_tests: 0, required_assertion_ids: [], script: 'checks/flood.mjs', parser_id: 'process_exit', parser_version: '1.0.0', timeout_seconds: 30, maximum_output_bytes: 4096, environment_profile_id: 'local-node' },
  { check_id: 'exit-zero-no-report', required: false, result_kind: 'tests', minimum_tests: 1, required_assertion_ids: [], script: 'checks/silent.mjs', parser_id: 'tap13', parser_version: '1.0.0', timeout_seconds: 30, maximum_output_bytes: 65536, environment_profile_id: 'local-node' },
  { check_id: 'malformed-report', required: false, result_kind: 'tests', minimum_tests: 1, required_assertion_ids: [], script: 'checks/malformed.mjs', parser_id: 'tap13', parser_version: '1.0.0', timeout_seconds: 30, maximum_output_bytes: 65536, environment_profile_id: 'local-node' },
  { check_id: 'changed-parser-version', required: false, result_kind: 'tests', minimum_tests: 1, required_assertion_ids: [], script: 'checks/passing.mjs', parser_id: 'tap13', parser_version: '9.9.9', timeout_seconds: 30, maximum_output_bytes: 65536, environment_profile_id: 'local-node' },
];

registerScenario('AT-005', async (): Promise<ScenarioObservation> => {
  const evidence = await Evidence.open('T05');
  const clock = fixedClock('2026-09-07T16:00:00.000Z');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t05-'));
  const workspace = path.join(sandbox, 'candidate');
  const secretsDir = path.join(sandbox, 'protected-secrets');
  const log: Record<string, unknown> = {};

  mkdirSync(workspace, { recursive: true });
  mkdirSync(secretsDir, { recursive: true });
  const secretFile = path.join(secretsDir, 'signing-key.pem');
  writeFileSync(secretFile, 'CANARY-SIGNING-KEY-MUST-NOT-BE-READABLE\n');
  const socketPath = path.join(secretsDir, 'coordinator.sock');
  const socketServer = createServer(connection => connection.end('reachable\n'));
  await new Promise<void>(resolve => socketServer.listen(socketPath, resolve));
  // A signing-key canary in the coordinator's own environment. The child must not inherit it.
  process.env['CM_SIGNING_KEY'] = 'CANARY-ENV-SIGNING-KEY';

  fixtures(workspace, { file: secretFile, socket: socketPath });
  const store = ProtectedPolicyStore.open(path.join(sandbox, 'verifier-authority'));

  try {
    const at = clock();
    const profiles: EnvironmentProfile[] = [
      {
        profile_id: 'local-node', required_platform: null, required_executables: ['node'],
        denied_read_paths: [secretsDir], allowed_write_paths: [], allow_home_read: false,
        toolchain_paths: [NODE_DIR],
        description: 'Node checks with the host home denied and the protected secret store denied.',
      },
      {
        profile_id: 'ios-device', required_platform: 'ios', required_executables: ['node'],
        denied_read_paths: [secretsDir], allowed_write_paths: [], allow_home_read: false,
        toolchain_paths: [NODE_DIR], description: 'Physical iOS target; unavailable on this host.',
      },
      {
        profile_id: 'model-eval', required_platform: null, required_executables: ['authorized-model-runner'],
        denied_read_paths: [secretsDir], allowed_write_paths: [], allow_home_read: false,
        toolchain_paths: [NODE_DIR], description: 'Authorized model and dataset runner; not installed.',
      },
    ];
    for (const profile of profiles) store.registerEnvironmentProfile(profile, 'security_owner', at);

    const definitions = CHECKS.map(spec => store.registerDefinition({
      definition: {
        check: {
          check_id: spec.check_id, required: spec.required, result_kind: spec.result_kind,
          minimum_tests: spec.minimum_tests, required_assertion_ids: spec.required_assertion_ids,
          maximum_skipped: 0,
        },
        argv: [NODE, spec.script], cwd_relative: '.', parser_id: spec.parser_id,
        timeout_seconds: spec.timeout_seconds, maximum_output_bytes: spec.maximum_output_bytes,
        environment_profile_id: spec.environment_profile_id, network_profile_id: 'deny',
      },
      parser_version: spec.parser_version, approved_by: 'security_owner', at,
    }));

    const draft: Omit<Policy, 'policy_digest'> & { policy_digest: string } = {
      kind: 'policy', schema_version: 1, policy_id: 'policy_t05', project_id: PROJECT,
      policy_digest: '', requirements_revision: 1,
      checks: definitions.map(definition => definition.check),
      maximum_age_seconds: 86400, trusted_issuer_ids: ['verifier_t05'], authority: 'protected',
    };
    const policy: Policy = { ...draft, policy_digest: digest(draft, 'policy_digest') };
    store.registerPolicy(policy, 'security_owner', at);

    const source = snapshot(workspace, `file://${workspace}`);
    const artifact = readFileSync(path.join(workspace, 'package.json'));
    const candidate: Candidate = {
      kind: 'candidate', schema_version: 1, candidate_id: 'candidate_t05',
      project_id: PROJECT, run_id: 'run_t05', source_digest: source.source_digest,
      artifact_digest: `sha256:${createHash('sha256').update(artifact).digest('hex')}`,
      requirements_revision: 1, policy_digest: policy.policy_digest,
      environment_digest: digest({ platform: os.platform(), node: process.versions.node }),
      created_at: at,
    };

    const coordinator = new VerificationCoordinator({
      store, issuer_id: 'verifier_t05', clock, sandbox_parent: sandbox,
    });

    // 1. An unknown check ID is refused, and a requester cannot add one by asking.
    const unknown = attempt(() => store.resolve(policy.policy_digest, 'check-that-does-not-exist'));
    const selected = store.selectChecks(policy.policy_digest, ['check-that-does-not-exist', 'output-flood']);
    log['unknown_check'] = { resolve: unknown, selected };
    const unknownCheckRejected = !unknown.ok && unknown.message.startsWith('UNKNOWN_CHECK_ID') &&
      !selected.includes('check-that-does-not-exist') && selected.includes('output-flood');

    // 2. A worker-supplied command is refused before anything is resolved, and the argv that
    //    actually runs is the approved one.
    const withArgv = await attemptAsync(() => coordinator.verify({
      project_id: PROJECT, run_id: 'run_t05', attempt_id: 'attempt_t05', candidate,
      policy_digest: policy.policy_digest, requested_check_ids: [], workspace_root: workspace,
      idempotency_key: 'injected', argv: ['/bin/sh', '-c', 'cat ' + secretFile],
    } as never));
    const shapes = ['argv', 'command', 'cmd', 'script', 'shell', 'exec']
      .map(key => ({ key, ...VerificationCoordinator.rejectCallerArgv({ [key]: ['/bin/sh'] }) }));
    log['caller_argv'] = { verify: withArgv, shapes, approved_argv: definitions[0]?.argv };
    const arbitraryCommandRejected = !withArgv.ok && withArgv.message.includes('CALLER_SUPPLIED_COMMAND_REFUSED') &&
      shapes.every(shape => shape.rejected);

    // 3. Run the full protected verification.
    const outcome = await coordinator.verify({
      project_id: PROJECT, run_id: 'run_t05', attempt_id: 'attempt_t05', candidate,
      policy_digest: policy.policy_digest,
      requested_check_ids: ['hang-and-fork', 'output-flood', 'exit-zero-no-report', 'malformed-report', 'changed-parser-version'],
      workspace_root: workspace, idempotency_key: 'verify-t05',
    });
    const byCheck = new Map(outcome.observations.map(observation => [observation.result.check_id, observation]));
    const security = byCheck.get('security-probe');
    const securityReport = security === undefined ? null : security.result.assertion_ids;
    log['security_probe'] = {
      status: security?.result.status, reasons: security?.reasons,
      denied_assertions: securityReport, isolation: security?.isolation,
    };
    // The sandbox stops the candidate reaching the authority. It says nothing about what any
    // other account on this machine can read straight off the disk, and that is a different
    // question with its own answer: the stores hold signing material, the record of who
    // approved which deployment, and every client request.
    const permissionRoots = [path.join(sandbox, 'verifier-authority')];
    const worldReadable = auditPermissions(permissionRoots);
    log['file_permissions'] = {
      roots: permissionRoots,
      readable_by_other_accounts: worldReadable,
      modes: permissionRoots.flatMap(root => (existsSync(root) ? readdirSync(root).map(entry => ({
        path: path.join(root, entry),
        mode: `0${(statSync(path.join(root, entry)).mode & 0o777).toString(8)}`,
      })) : [])),
    };

    // Two properties, not one. The directory keeps other accounts out; the file modes have to
    // hold on their own as well, because the database and the write-ahead log it creates on
    // first write get copied into backups and archives where the directory does not follow.
    const storeFileModes = (log['file_permissions'] as { modes: Array<{ path: string; mode: string }> }).modes;
    const everyStoreFilePrivate = storeFileModes.length >= 2 && storeFileModes.every(entry => entry.mode === '0600');

    const secretDenied = worldReadable.length === 0 && everyStoreFilePrivate &&
      security !== undefined && security.result.status === 'PASSED' &&
      ['no_secret_access', 'no_env_secret', 'no_home_read', 'no_network', 'no_unix_socket']
        .every(assertion => security.result.assertion_ids.includes(assertion));

    // 4. The hanging, forking check is killed as a tree or explicitly quarantined.
    const hang = byCheck.get('hang-and-fork');
    const heartbeat = path.join(workspace, 'heartbeat.txt');
    const heartbeatSize = (): number => {
      try { return statSync(heartbeat).size; } catch { return -1; }
    };
    const heartbeatAfterKill = heartbeatSize();
    await new Promise(done => setTimeout(done, 500));
    const heartbeatLater = heartbeatSize();
    log['timeout'] = {
      status: hang?.result.status, timed_out: hang?.timed_out, reasons: hang?.reasons,
      process_tree_terminated: hang === undefined ? null : !hang.quarantined,
      quarantined: hang?.quarantined,
      heartbeat_bytes_at_kill: heartbeatAfterKill, heartbeat_bytes_500ms_later: heartbeatLater,
      forked_child_stopped_writing: heartbeatAfterKill === heartbeatLater,
    };
    const timeoutHandled = hang !== undefined && hang.timed_out &&
      hang.result.status === 'TIMEOUT' && heartbeatAfterKill === heartbeatLater &&
      (!hang.quarantined || hang.reasons.includes('PROCESS_TREE_SURVIVED'));

    // 5. Exit zero without a report, a malformed report and a changed parser version are all
    //    unverified, and the flood is truncated rather than allowed to run away.
    const silent = byCheck.get('exit-zero-no-report');
    const malformed = byCheck.get('malformed-report');
    const parserMismatch = byCheck.get('changed-parser-version');
    const flood = byCheck.get('output-flood');
    log['reports'] = {
      silent: { status: silent?.result.status, reasons: silent?.reasons },
      malformed: { status: malformed?.result.status, reasons: malformed?.reasons },
      parser_mismatch: { status: parserMismatch?.result.status, reasons: parserMismatch?.reasons, parser_version: parserMismatch?.parser_version },
      flood: { status: flood?.result.status, truncated: flood?.output_truncated, bytes: flood?.result.log_digest },
    };
    const malformedUnverified =
      silent?.result.status === 'UNVERIFIED' && silent.reasons.includes('MISSING_REPORT') &&
      malformed?.result.status === 'UNVERIFIED' && malformed.reasons.includes('MALFORMED_REPORT') &&
      parserMismatch?.result.status === 'UNVERIFIED' && parserMismatch.reasons.includes('PARSER_VERSION_MISMATCH') &&
      flood?.output_truncated === true;

    // 6. Missing native and model environments stay unverified with nothing run in their place.
    const ios = byCheck.get('ios-ui-journey');
    const model = byCheck.get('model-retrieval-eval');
    const executedChecks = outcome.observations.filter(observation => observation.result.executed).map(observation => observation.result.check_id);
    log['missing_environments'] = {
      ios: { status: ios?.result.status, executed: ios?.result.executed, reasons: ios?.reasons },
      model: { status: model?.result.status, executed: model?.result.executed, reasons: model?.reasons },
      blocked_checks: outcome.blocked_checks, executed_checks: executedChecks,
      integrity_passed: outcome.evidence.integrity_passed,
    };
    const missingEnvironmentNotPassed =
      ios?.result.status === 'UNVERIFIED' && ios.result.executed === false && ios.reasons.includes('PLATFORM_UNAVAILABLE') &&
      model?.result.status === 'UNVERIFIED' && model.result.executed === false && model.reasons.includes('TOOLCHAIN_UNAVAILABLE') &&
      !executedChecks.includes('ios-ui-journey') && !executedChecks.includes('model-retrieval-eval') &&
      outcome.evidence.integrity_passed === false;

    const evidenceValid = validateEntity(outcome.evidence);
    await evidence.write('verification.json', log);
    await evidence.write('evidence-envelope-payload.json', outcome.evidence);
    await evidence.write('observations.json', outcome.observations);
    await evidence.write('schema.json', evidenceValid);

    return {
      scenario_id: 'AT-005',
      mode: 'integration',
      observed: {
        unknown_check_rejected: unknownCheckRejected,
        arbitrary_command_rejected: arbitraryCommandRejected,
        secret_and_socket_access_denied: secretDenied,
        timeout_tree_terminated_or_quarantined: timeoutHandled,
        malformed_report_unverified: malformedUnverified,
        missing_target_environment_not_passed: missingEnvironmentNotPassed,
        isolation_kind: security?.isolation?.kind ?? 'none',
        evidence_schema_valid: evidenceValid.valid,
        unit_tests_passed: byCheck.get('unit-tests')?.result.status === 'PASSED',
      } satisfies Record<string, Json>,
      artifact_paths: evidence.paths,
    };
  } finally {
    delete process.env['CM_SIGNING_KEY'];
    await new Promise<void>(resolve => socketServer.close(() => resolve()));
    store.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
