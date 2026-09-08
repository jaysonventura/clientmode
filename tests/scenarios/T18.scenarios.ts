/** AT-018 executor.
 *
 * A thousand real rows in a real database, a migration that fails part-way, a configuration
 * edited while the upgrade is running, and a process tree that outlives its parent. The
 * timings are measured, not estimated, and the reference machine is recorded with them.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientRequest, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { reconcile } from '../../packages/state/src/recovery.js';
import { assessRollback, mergeConfiguration, restore, upgrade, type Migration } from '../../packages/packaging/src/upgrade.js';
import { uninstallToolkit } from '../../packages/packaging/src/uninstall.js';
import { install } from '../../apps/cli/src/install.js';
import { COMMANDS, EXIT_CODES, commandNames, describe } from '../../apps/cli/src/main.js';
import { cancelRun, createRun, readAuthorizedRequestFile } from '../../apps/cli/src/run.js';
import { validate, rejectsCallerCommand } from '../../apps/cli/src/verify.js';
import { Evidence, ROOT, attempt, fixedClock } from '../harness/evidence.js';
import { raceOpen, runCli, runCliDetailed, UNWIRED_MARKER } from '../harness/cli.js';
import { checkInstall } from '../../packages/packaging/src/install-health.js';
import { activate } from '../../apps/cli/src/cm.js';
import { packageToolkit } from '../harness/package-toolkit.js';
import { buildDistribution } from '../../packages/packaging/src/build.js';
import { registerScenario } from '../harness/registry.js';
import { auditPermissions } from '../../packages/verifier/src/file-permissions.js';

const PROJECT = 'project_t18';
const NOW = '2026-09-08T20:00:00.000Z';
const TASK_COUNT = 1000;

/** The commands docs/OPERATIONS.md names. The CLI surface must cover all of them. */
const CONTRACT_COMMANDS = ['doctor', 'install', 'uninstall', 'upgrade', 'open', 'run', 'pause', 'resume', 'cancel', 'status', 'verify', 'export-evidence', 'rollback'];

registerScenario('AT-018', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T18');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t18-'));
  const stateDir = path.join(sandbox, 'state');
  const log: Record<string, unknown> = {};
  let db = ControllerDatabase.open(stateDir);

  try {
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${sandbox}/work`, profile_id: 'discover', data_class: 'internal' });

    // 1. The command surface matches the operations contract, including its exit codes.
    const missingCommands = CONTRACT_COMMANDS.filter(name => !commandNames().includes(name));
    log['commands'] = {
      contract: CONTRACT_COMMANDS, implemented: commandNames(), missing: missingCommands,
      exit_codes: EXIT_CODES,
      refusals: COMMANDS.map(command => ({ command: command.name, refuses: command.refuses })),
      verify_refuses_caller_command: rejectsCallerCommand({ candidate: 'x', argv: ['/bin/sh'] }),
      verify_accepts_candidate_only: !rejectsCallerCommand({ candidate: 'x', policy_digest: 'y' }),
    };
    // A command that is declared and cannot be run is a promise the operator cannot keep. Each
    // one is invoked for real against a disposable project; `missing_capability` from the
    // dispatcher means it was never wired to an entry point.
    const cliRoot = mkdtempSync(path.join(tmpdir(), 'cm-cli-'));
    const cliHome = path.join(cliRoot, 'home');
    const invocations = [
      ['doctor', ['doctor', '--json']],
      ['run', ['run', '--root', cliRoot, '--request-file', path.join(cliRoot, 'request.txt')]],
      ['status', ['status', 'run_that_does_not_exist', '--root', cliRoot]],
      ['pause', ['pause', 'run_that_does_not_exist', '--root', cliRoot]],
      ['resume', ['resume', 'run_that_does_not_exist', '--root', cliRoot]],
      ['cancel', ['cancel', 'run_that_does_not_exist', '--root', cliRoot]],
      ['verify', ['verify', '--candidate', 'candidate_that_does_not_exist', '--root', cliRoot]],
      ['export-evidence', ['export-evidence', '--candidate', 'candidate_that_does_not_exist', '--root', cliRoot]],
      ['rollback', ['rollback', '--toolkit-version', '0.0.0', '--root', cliRoot]],
      ['upgrade', ['upgrade', '--version', '0.0.0', '--root', cliRoot]],
      ['install', ['install', '--host', 'claude', '--dry-run', '--install-root', path.join(cliRoot, 'host')]],
      ['uninstall', ['uninstall', '--host', 'claude']],
      ['handoff', ['handoff', '--root', cliRoot, '--json']],
      ['use', ['use', 'claude']],
    ] as const;
    writeFileSync(path.join(cliRoot, 'request.txt'), 'a small ordering page for my shop\n');
    // Each command gets its own state home. Sharing one made the result depend on which
    // command happened to run first — `rollback` finding a snapshot `upgrade` had just taken —
    // and a gate whose answer changes between runs is measuring the scheduler, not the code.
    const runs = await Promise.all(invocations.map(async ([name, argv]) => ({
      name, ...await runCliDetailed(argv, path.join(cliHome, name)),
    })));
    const unwired = runs.filter(entry => entry.stderr.includes(UNWIRED_MARKER)).map(entry => entry.name);
    // Every exit code has to be one the contract defines, and `internal` is not an answer: each
    // of these is invoked with a well-formed request naming something that does not exist, so
    // the honest reply is "no such thing", not a crash.
    const offContract = runs.filter(entry => !Object.values(EXIT_CODES).includes(entry.exit_code as never));
    const crashed = runs.filter(entry => entry.exit_code === EXIT_CODES.internal).map(entry => entry.name);
    // The install's own health: a broken install has to be reported as broken, with a remedy
    // beside each finding. Every one of these is a state a client's machine actually reaches.
    const healthRoot = path.join(cliRoot, 'health');
    const healthHosts = [
      { host: 'claude', install_root: path.join(healthRoot, 'claude') },
      { host: 'codex', install_root: path.join(healthRoot, 'codex') },
    ];
    const emptyHealth = checkInstall({
      home: path.join(healthRoot, 'home'), source_root: ROOT,
      hosts: healthHosts, launcher_path: path.join(healthRoot, 'bin', 'cm'),
    });
    // A real install, then each way it degrades.
    const distributions = {
      claude: buildDistribution({ provider: 'claude', source_root: ROOT, out_root: path.join(healthRoot, 'dist'), version: '0.1.0' }),
      codex: buildDistribution({ provider: 'codex', source_root: ROOT, out_root: path.join(healthRoot, 'dist'), version: '0.1.0' }),
    };
    const healthHome = path.join(healthRoot, 'installed-home');
    const healthLauncher = path.join(healthRoot, 'installed-bin', 'cm');
    await packageToolkit({ out_root: path.join(healthHome, 'toolkit'), launcher_path: healthLauncher });
    for (const entry of healthHosts) {
      activate({ host: entry.host as 'claude' | 'codex', install_root: entry.install_root,
        distribution_root: entry.host === 'claude' ? distributions.claude.root : distributions.codex.root, lead: true });
    }
    const goodHealth = checkInstall({ home: healthHome, source_root: ROOT, hosts: healthHosts, launcher_path: healthLauncher });
    // An install made before the stores were tightened, or one restored from a backup, keeps
    // the modes it was created with. The client's requests and the approval record are in
    // there, so doctor has to name it rather than call the install healthy.
    const exposedStore = path.join(healthHome, 'projects', 'p1', 'state');
    mkdirSync(exposedStore, { recursive: true, mode: 0o755 });
    writeFileSync(path.join(exposedStore, 'state.sqlite'), 'not a database', { mode: 0o644 });
    chmodSync(exposedStore, 0o755);
    const exposedHealth = checkInstall({ home: healthHome, source_root: ROOT, hosts: healthHosts, launcher_path: healthLauncher });
    rmSync(path.join(healthHome, 'projects'), { recursive: true, force: true });
    rmSync(path.join(healthHome, 'toolkit'), { recursive: true, force: true });
    const orphanedHealth = checkInstall({ home: healthHome, source_root: ROOT, hosts: healthHosts, launcher_path: healthLauncher });
    log['install_health'] = { empty: emptyHealth, good: goodHealth, orphaned: orphanedHealth, exposed: exposedHealth };
    const healthReported =
      !emptyHealth.healthy && emptyHealth.findings.some(finding => finding.code === 'TOOLKIT_MISSING') &&
      emptyHealth.findings.some(finding => finding.code === 'INSTRUCTIONS_MISSING') &&
      emptyHealth.findings.some(finding => finding.code === 'LAUNCHER_MISSING') &&
      emptyHealth.findings.some(finding => finding.code === 'SKILLS_MISSING') &&
      emptyHealth.findings.every(finding => finding.remedy.length > 0) &&
      goodHealth.healthy && goodHealth.hosts.every(host => host.skills === 8) &&
      !exposedHealth.healthy &&
      exposedHealth.findings.some(finding => finding.code === 'STORE_WORLD_READABLE'
        && finding.detail.includes(exposedStore) && finding.remedy.startsWith('chmod ')) &&
      !orphanedHealth.healthy &&
      orphanedHealth.findings.some(finding => finding.code === 'LAUNCHER_ORPHANED') &&
      orphanedHealth.findings.every(finding => finding.remedy.startsWith('cm ') || finding.remedy.startsWith('chmod '));

    // And the exit code has to carry it: a `doctor` that reports a broken install and then
    // exits 0 has told a script everything is fine.
    const doctorOnBrokenInstall = await runCliDetailed(['doctor', '--json'], path.join(healthRoot, 'no-install-home'));
    const doctorReportsBroken = doctorOnBrokenInstall.exit_code === EXIT_CODES.missing_capability;
    log['doctor_on_broken_install'] = doctorOnBrokenInstall.exit_code;

    // Two terminals in one project is ordinary. The exclusive state-directory lock belongs to
    // the process that owns the run loop, not to a `status` call — six of those at once must
    // all answer, and none may crash on a lock the other five are holding.
    const concurrentHome = path.join(cliRoot, 'concurrent-home');
    const concurrentStatus = await Promise.all(Array.from({ length: 6 }, () =>
      runCli(['status', 'run_that_does_not_exist', '--root', cliRoot], concurrentHome)));
    const concurrentOk = concurrentStatus.every(code => code === EXIT_CODES.input_or_contract_error);
    // And the same directory opened by eight processes at one instant, which is the case the
    // schema bootstrap has to survive: all of them find the state ready, none finds it half-made.
    const raced = await raceOpen(path.join(cliRoot, 'raced-state'), 8);
    const raceOk = raced.every(code => code === 0);
    // The upgrade case, which is every install that exists today: $CM_HOME and its projects
    // directory are already there at the process umask, so creating the state directory
    // owner-only is not enough on its own — the two above it have to be brought down too.
    const legacyHome = path.join(cliRoot, 'legacy-home');
    mkdirSync(path.join(legacyHome, 'projects'), { recursive: true, mode: 0o755 });
    chmodSync(legacyHome, 0o755);
    chmodSync(path.join(legacyHome, 'projects'), 0o755);
    const legacyExit = await runCli(['status', 'run_that_does_not_exist', '--root', cliRoot], legacyHome);
    const legacyExposed = auditPermissions([legacyHome]);
    log['legacy_home_tightened'] = { home: legacyHome, exit_code: legacyExit, readable_by_other_accounts: legacyExposed };

    // What those real invocations left on disk. The state directory holds every client request
    // and the run record; a mode is not something to assume, so it is read back.
    const cliExposed = auditPermissions([cliHome, concurrentHome]);
    // The briefing is the one file that leaves the store — it gets copied and mailed around —
    // so its own mode has to hold, not just the directory's.
    const briefings = readdirSync(cliHome, { recursive: true, encoding: 'utf8' })
      .filter(entry => entry.endsWith('HANDOFF.md'))
      .map(entry => ({ path: entry, mode: `0${(statSync(path.join(cliHome, entry)).mode & 0o777).toString(8)}` }));
    log['state_permissions'] = {
      roots: [cliHome, concurrentHome], readable_by_other_accounts: cliExposed, briefings,
    };
    log['cli_invocations'] = {
      runs: runs.map(entry => ({ name: entry.name, exit_code: entry.exit_code })),
      unwired, off_contract: offContract, crashed, home: cliHome,
      concurrent_status_exit_codes: concurrentStatus, concurrent_all_answered: concurrentOk,
      simultaneous_open_exit_codes: raced, simultaneous_open_all_succeeded: raceOk,
    };
    rmSync(cliRoot, { recursive: true, force: true });

    const commandsMatch = unwired.length === 0 && offContract.length === 0 && crashed.length === 0 &&
      concurrentOk && raceOk && healthReported && doctorReportsBroken && cliExposed.length === 0 &&
      legacyExposed.length === 0 &&
      briefings.length > 0 && briefings.every(entry => entry.mode === '0600') &&
      missingCommands.length === 0 &&
      describe('verify')?.refuses.includes('accepting a caller-supplied command string') === true &&
      rejectsCallerCommand({ candidate: 'x', argv: ['/bin/sh'] }) &&
      Object.keys(EXIT_CODES).length === 8;

    // `cm run` reads only from the authorized root.
    const authorizedRoot = path.join(sandbox, 'work');
    mkdirSync(authorizedRoot, { recursive: true });
    writeFileSync(path.join(authorizedRoot, 'brief.txt'), 'Simple ordering site. No account, no online payment.\n');
    const outsideFile = path.join(sandbox, 'elsewhere.txt');
    writeFileSync(outsideFile, 'a brief from outside the authorized root\n');
    const insideRead = readAuthorizedRequestFile({ file: path.join(authorizedRoot, 'brief.txt'), authorized_root: authorizedRoot });
    const outsideRead = readAuthorizedRequestFile({ file: outsideFile, authorized_root: authorizedRoot });
    const created = await createRun({
      service, project_id: PROJECT, request_file: path.join(authorizedRoot, 'brief.txt'),
      authorized_root: authorizedRoot, idempotency_key: 'cm-run-1', now: NOW,
    });
    log['run_command'] = {
      inside: 'text' in insideRead, outside: outsideRead, exit_code: created.exit_code, run_created: created.run !== undefined,
    };

    // 2. A thousand durable tasks, then recovery timed on this machine.
    const run = created.run!;
    const request: ClientRequest = {
      kind: 'client_request', schema_version: 1, request_id: 'request_t18_bulk', project_id: PROJECT,
      message: 'bulk', language_hint: 'en', attachment_ids: [], privacy_class: 'internal', created_at: NOW,
    };
    void request;
    for (let index = 0; index < TASK_COUNT; index += 1) {
      service.createAttempt({
        attempt_id: `attempt_${index}`, project_id: PROJECT, run_id: run.run_id, task_id: `task_${index}`,
        attempt_number: 1, role: 'writer', parent_attempt_id: null, depth: 0, workspace_id: `ws_${index}`,
        base_source_digest: `sha256:${'a'.repeat(64)}`, allowed_write_paths: [`module_${index}/`],
        dependency_task_ids: [], deadline: '2026-09-08T19:00:00.000Z', provider_session_id: null,
      });
      db.run("UPDATE task_attempts SET status = 'RUNNING' WHERE attempt_id = ?", `attempt_${index}`);
      db.run('INSERT INTO workspace_leases (lease_id, project_id, attempt_id, workspace_id, owner_id, is_writer, active, epoch, expires_at) VALUES (?,?,?,?,?,0,1,1,?)',
        `lease_${index}`, PROJECT, `attempt_${index}`, `ws_${index}`, `worker_${index}`, '2026-09-08T19:00:00.000Z');
    }
    const storedTasks = Number(db.get('SELECT COUNT(*) AS n FROM task_attempts WHERE run_id = ?', run.run_id)?.['n'] ?? 0);

    // Close and reopen: recovery has to read this from disk, not from memory.
    db.close();
    const recoveryStarted = Date.now();
    db = ControllerDatabase.open(stateDir);
    const reconciliation = reconcile(db, '2026-09-09T00:00:00.000Z');
    const recoveryElapsed = Date.now() - recoveryStarted;
    log['recovery'] = {
      stored_tasks: storedTasks, elapsed_ms: recoveryElapsed,
      expired_leases: reconciliation.expired_leases.length,
      revoked_attempts: reconciliation.revoked_attempts.length,
      reference_machine: { platform: `${os.platform()}-${os.arch()}`, cpus: os.cpus().length, node: process.versions.node },
    };
    const recoveryFast = storedTasks === TASK_COUNT && recoveryElapsed < 30_000 &&
      reconciliation.revoked_attempts.length === TASK_COUNT;

    // 3. Cancel: the intent is recorded within a second, and the tree is checked separately.
    const recoveredService = new LifecycleService(db, { clock });
    const heartbeat = path.join(sandbox, 'heartbeat.txt');
    // A parent that forks a child which outlives it, in its own process group. The scripts are
    // files rather than nested `-e` strings, so the quoting cannot quietly break the fixture
    // and leave the heartbeat evidence empty.
    const childScript = path.join(sandbox, 'heartbeat-child.mjs');
    const parentScript = path.join(sandbox, 'heartbeat-parent.mjs');
    writeFileSync(childScript, `import { appendFileSync } from 'node:fs';\nsetInterval(() => { try { appendFileSync(${JSON.stringify(heartbeat)}, 'x'); } catch {} }, 40);\n`);
    writeFileSync(parentScript, `import { spawn } from 'node:child_process';\nspawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n`);
    const parent = spawn(process.execPath, [parentScript], { detached: true, stdio: 'ignore' });
    await new Promise(resolve => setTimeout(resolve, 600));
    const beforeKill = existsSync(heartbeat) ? readFileSync(heartbeat).byteLength : 0;

    const cancelled = cancelRun({
      service: recoveredService, run_id: run.run_id,
      stopTree: () => {
        const started = Date.now();
        try { if (parent.pid !== undefined) process.kill(-parent.pid, 'SIGKILL'); } catch { /* already gone */ }
        // Confirm rather than assume: wait, then look at whether the group still exists.
        const deadline = Date.now() + 10_000;
        let alive = true;
        while (Date.now() < deadline) {
          try {
            if (parent.pid === undefined) { alive = false; break; }
            process.kill(-parent.pid, 0);
          } catch { alive = false; break; }
        }
        return { terminated: !alive, quarantined: alive, elapsed_ms: Date.now() - started };
      },
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    const afterKill = existsSync(heartbeat) ? readFileSync(heartbeat).byteLength : 0;
    log['cancel'] = {
      acknowledged_in_ms: cancelled.acknowledged_in_ms, tree: cancelled.tree,
      leases_revoked: cancelled.leases_revoked.length,
      heartbeat_before_kill: beforeKill, heartbeat_after_kill: afterKill,
      forked_child_was_writing: beforeKill > 0,
      forked_child_stopped: beforeKill > 0 && afterKill - beforeKill <= 1,
    };
    const cancelFast = cancelled.acknowledged_in_ms < 1000;
    const treeStopped = cancelled.tree !== null &&
      (cancelled.tree.terminated || cancelled.tree.quarantined) &&
      cancelled.tree.checked_after_ms <= 10_000 &&
      // The grandchild has to have been writing, or "it stopped" says nothing.
      beforeKill > 0 && afterKill - beforeKill <= 1;

    // 4. An upgrade whose migration fails leaves the previous state intact.
    const statePath = path.join(stateDir, 'state.sqlite');
    const configPath = path.join(sandbox, 'config.json');
    writeFileSync(configPath, JSON.stringify({ theme: 'dark', clientMode: { version: '0.1.0' } }, null, 2) + '\n');
    // Measured after closing: a WAL checkpoint on close rewrites the main file, so a size or
    // digest taken while the database is open describes a different file.
    db.close();
    const stateBefore = createHash('sha256').update(readFileSync(statePath)).digest('hex');

    let activated = '0.1.0';
    const failing: Migration[] = [
      { version: 2, kind: 'expand', reversible: true, apply: () => { /* additive step succeeds */ } },
      { version: 3, kind: 'contract', reversible: false, apply: () => { throw new Error('power loss during the contract step'); } },
    ];
    const failedUpgrade = upgrade({
      state_path: statePath, config_path: configPath, backup_dir: path.join(sandbox, 'backups'),
      from_version: '0.1.0', to_version: '0.2.0', migrations: failing,
      activate: version => { activated = version; }, now: NOW,
    });
    const stateAfterFailure = createHash('sha256').update(readFileSync(statePath)).digest('hex');

    // A user edited the configuration while the upgrade was running.
    const concurrent = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    concurrent['statusLine'] = { command: 'my-status' };
    writeFileSync(configPath, JSON.stringify(concurrent, null, 2) + '\n');
    const merged = mergeConfiguration({
      config_path: configPath, owned_keys: ['clientMode'], owned_values: { clientMode: { version: '0.2.0' } },
    });

    const successful = upgrade({
      state_path: statePath, config_path: configPath, backup_dir: path.join(sandbox, 'backups2'),
      from_version: '0.1.0', to_version: '0.2.0',
      migrations: [{ version: 2, kind: 'expand', reversible: true, apply: () => { /* additive */ } }],
      activate: version => { activated = version; }, now: NOW,
    });
    const reversible = assessRollback([{ version: 2, kind: 'expand', reversible: true, apply: () => {} }], successful.snapshot);
    const irreversible = assessRollback(failing, successful.snapshot);
    const restored = restore({ snapshot: successful.snapshot, state_path: statePath, config_path: configPath });
    log['upgrade'] = {
      failed: failedUpgrade, state_digest_before: stateBefore, state_digest_after_failure: stateAfterFailure,
      state_identical_after_failed_upgrade: stateBefore === stateAfterFailure,
      version_activated_after_failure: failedUpgrade.upgraded ? activated : '0.1.0',
      concurrent_edit: merged, rollback_reversible: reversible, rollback_irreversible: irreversible,
      restored: restored.restored.length,
    };
    const upgradePreservesState = !failedUpgrade.upgraded && failedUpgrade.failed_at === 3 &&
      failedUpgrade.state_restored && stateAfterFailure === stateBefore &&
      irreversible.rollback_safe === false && irreversible.reason === 'IRREVERSIBLE_MIGRATION_APPLIED' &&
      reversible.rollback_safe === true;
    const concurrentEditKept = merged.preserved_keys.includes('statusLine') &&
      (JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>)['statusLine'] !== undefined;

    // 5. Uninstall leaves project work and retained evidence alone.
    const installRoot = path.join(sandbox, 'install');
    const installed = install({
      provider: 'claude', source_root: ROOT, out_root: path.join(sandbox, 'dist'),
      install_root: installRoot, version: '0.1.0', dry_run: false, now: NOW,
    });
    const uninstallReport = uninstallToolkit({
      record: installed.applied!,
      project_roots: [authorizedRoot],
      retention: [{ path: path.join(sandbox, 'evidence'), retain_until: '2027-01-01T00:00:00.000Z', reason: 'release manifest retention' }],
      now: NOW,
    });
    log['uninstall'] = {
      ...uninstallReport,
      brief_still_present: existsSync(path.join(authorizedRoot, 'brief.txt')),
    };

    // 6. A missing validation dependency is BLOCKED and nonzero, never green.
    const allPresent = validate([
      { name: 'node', required: true, available: true, detail: 'v22 present' },
      { name: 'jsonschema', required: true, available: true, detail: 'installed' },
    ]);
    const oneMissing = validate([
      { name: 'node', required: true, available: true, detail: 'v22 present' },
      { name: 'jsonschema', required: true, available: false, detail: 'not installed; schema validation did not run' },
      { name: 'ios-simulator', required: false, available: false, detail: 'optional target' },
    ]);
    log['validation'] = { all_present: allPresent, one_missing: oneMissing };
    const missingNotGreen = allPresent.exit_code === EXIT_CODES.ok && allPresent.status === 'PASS' &&
      oneMissing.exit_code === EXIT_CODES.missing_capability && oneMissing.status === 'BLOCKED' &&
      oneMissing.blocked.length === 1;

    const reopened = attempt(() => ControllerDatabase.open(stateDir));
    if (reopened.ok) reopened.value.close();

    await writer.write('operations.json', log);
    await writer.write('command-surface.json', COMMANDS);

    return {
      scenario_id: 'AT-018',
      mode: 'integration',
      observed: {
        commands_match_operations_contract: commandsMatch,
        failed_upgrade_preserves_state: upgradePreservesState,
        concurrent_user_edit_not_overwritten: concurrentEditKept,
        recovery_1000_tasks_within_30s: recoveryFast,
        cancel_ack_within_1s: cancelFast,
        owned_tree_stopped_within_10s_or_quarantined: treeStopped,
        unavailable_validation_dependency_not_green: missingNotGreen,
        recovery_elapsed_ms: recoveryElapsed,
        cancel_acknowledged_ms: Math.round(cancelled.acknowledged_in_ms * 100) / 100,
        reference_machine: `${os.platform()}-${os.arch()} node ${process.versions.node}`,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
