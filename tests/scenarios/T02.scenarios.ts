/** AT-002 executor. Real SQLite file, real second connection, real process kill. */
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ClientRequest, Contract, Json, ScenarioObservation, UsageEvent } from '../../contracts/interfaces.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { checkFence } from '../../packages/state/src/leases.js';
import { pending } from '../../packages/state/src/outbox.js';
import { reconcile } from '../../packages/state/src/recovery.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { Evidence, ROOT, attempt, attemptAsync, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const exec = promisify(execFile);
const PROJECT = 'project_t02';

async function fixture<T>(name: string, patch: Partial<T>): Promise<T> {
  const base = JSON.parse(await readFile(path.join(ROOT, 'contracts/examples', `${name}.json`), 'utf8')) as T;
  return { ...base, ...patch };
}

/** Commit an acknowledged run in a child process, then kill that process without cleanup. */
async function killAfterCommit(stateDir: string, request: ClientRequest): Promise<{ run_id: string; stdout: string; signal: string | null }> {
  const script = path.join(stateDir, 'commit-then-die.mjs');
  await writeFile(script, `import { ControllerDatabase } from ${JSON.stringify(path.join(ROOT, 'packages/state/src/database.ts'))};
import { LifecycleService } from ${JSON.stringify(path.join(ROOT, 'packages/core/src/lifecycle.ts'))};
const db = ControllerDatabase.open(process.argv[2]);
const service = new LifecycleService(db, { clock: () => '2026-09-07T13:00:00.000Z' });
const request = JSON.parse(process.argv[3]);
service.registerProject({ project_id: request.project_id, registered_root_ref: 'file://' + process.argv[2] + '/restart', profile_id: 'discover', data_class: 'internal' });
const run = await service.createRun(request, 'idem-restart');
process.stdout.write(JSON.stringify({ run_id: run.run_id, state: run.state }));
// No close(), no flush beyond the committed transaction: the process simply dies here.
process.kill(process.pid, 'SIGKILL');
`);
  const outcome = await exec(process.execPath, ['--import', 'tsx', script, stateDir, JSON.stringify(request)], { cwd: ROOT })
    .then(result => ({ stdout: result.stdout, signal: null as string | null }))
    .catch((error: { stdout?: string; signal?: string }) => ({ stdout: error.stdout ?? '', signal: error.signal ?? null }));
  return { run_id: (JSON.parse(outcome.stdout || '{}') as { run_id?: string }).run_id ?? '', stdout: outcome.stdout, signal: outcome.signal };
}

registerScenario('AT-002', async (): Promise<ScenarioObservation> => {
  const evidence = await Evidence.open('T02');
  const stateDir = await mkdtemp(path.join(tmpdir(), 'cm-t02-'));
  const clock = fixedClock('2026-09-07T12:00:00.000Z');
  const log: Record<string, unknown> = {};

  const request = await fixture<ClientRequest>('request', { request_id: 'request_t02', project_id: PROJECT });
  const contract = await fixture<Contract>('contract', { contract_id: 'contract_t02', project_id: PROJECT, request_ids: ['request_t02'] });

  let db = ControllerDatabase.open(stateDir);
  try {
    let service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${stateDir}/work`, profile_id: 'discover', data_class: 'internal' });

    // 1. The same request under the same idempotency key creates exactly one run.
    const first = await service.createRun(request, 'idem-1');
    const replay = await service.createRun(request, 'idem-1');
    const createdRunCount = Number(db.get('SELECT COUNT(*) AS n FROM runs WHERE project_id = ?', PROJECT)?.['n'] ?? 0);
    log['idempotent_replay'] = { first: first.run_id, replay: replay.run_id, rows: createdRunCount };

    // 2. Reusing that key with different input is a conflict, not a silent second run.
    const changed = await attemptAsync(() => service.createRun({ ...request, message: 'Different scope entirely.' }, 'idem-1'));
    log['changed_payload'] = changed;
    const changedPayloadConflict = !changed.ok && changed.code === 'IDEMPOTENCY_KEY_CONFLICT';

    // 3. Two transitions racing at expected state version 1: exactly one may win.
    service.recordContract(contract);
    const bind = { contract_id: contract.contract_id, requirements_revision: contract.revision };
    // Both targets are legal from RECEIVED and both guards are satisfiable, so the loser can
    // only be stopped by the compare-and-swap on state_version, not by an earlier check.
    service.requestControl({ run_id: first.run_id, action: 'block', actor: 'controller', reason: 'competing blocker' });
    const racers = await Promise.all([
      attemptAsync(() => service.transition({
        run_id: first.run_id, expected_version: 1, target: 'SCOPED', actor: 'controller',
        reason: 'scope the accepted request', guard_evidence_ids: [], idempotency_key: 'race-a', bind,
      })),
      attemptAsync(() => service.transition({
        run_id: first.run_id, expected_version: 1, target: 'BLOCKED', actor: 'controller',
        reason: 'competing blocker', guard_evidence_ids: [], idempotency_key: 'race-b',
      })),
    ]);
    const raceWinners = racers.filter(outcome => outcome.ok).length;
    const raceLoser = racers.find(outcome => !outcome.ok);
    // A second connection performing the same compare-and-swap must also change no rows.
    const rogue = new DatabaseSync(path.join(stateDir, 'state.sqlite'));
    const rogueChanges = Number(rogue.prepare('UPDATE runs SET state = ?, state_version = state_version + 1 WHERE run_id = ? AND state_version = ?')
      .run('RUNNING', first.run_id, 1).changes);
    rogue.close();
    log['race'] = { outcomes: racers.map(o => (o.ok ? 'COMMITTED' : o.code)), winners: raceWinners,
      loser_reason: raceLoser && !raceLoser.ok ? raceLoser.code : null, second_connection_rows: rogueChanges };

    // 4. Precontract control: pause, resume, block and cancel persist with no contract.
    const precontract = await service.createRun({ ...request, request_id: 'request_t02_pre' }, 'idem-pre');
    const states: string[] = [precontract.state];
    const control = async (action: 'pause' | 'resume' | 'cancel' | 'block', target: Parameters<typeof service.transition>[0]['target']) => {
      service.requestControl({ run_id: precontract.run_id, action, actor: 'controller', reason: `precontract ${action}` });
      const current = await service.getRun(precontract.run_id);
      const moved = await service.transition({
        run_id: precontract.run_id, expected_version: current.state_version, target, actor: 'controller',
        reason: `precontract ${action}`, guard_evidence_ids: [], idempotency_key: `pre-${action}`,
      });
      states.push(`${moved.state}@rev${moved.requirements_revision}${moved.contract_id === null ? '/no-contract' : ''}`);
      return moved;
    };
    await control('pause', 'PAUSED');
    await control('resume', 'RECEIVED');
    await control('block', 'BLOCKED');
    await control('cancel', 'CANCELLED');
    const stored = db.get('SELECT state, contract_id, requirements_revision FROM runs WHERE run_id = ?', precontract.run_id)!;
    log['precontract'] = { states, stored, intents: db.all('SELECT action, leases_revoked FROM run_control_intents WHERE run_id = ?', precontract.run_id) };
    const precontractPersist = states.join(' -> ') ===
      'RECEIVED -> PAUSED@rev0/no-contract -> RECEIVED@rev0/no-contract -> BLOCKED@rev0/no-contract -> CANCELLED@rev0/no-contract' &&
      String(stored['state']) === 'CANCELLED' && stored['contract_id'] === null;

    // 5. Kill a controller after an acknowledged commit and reopen its state directory.
    db.close();
    const restart = await killAfterCommit(stateDir, { ...request, request_id: 'request_t02_restart' });
    db = ControllerDatabase.open(stateDir);
    service = new LifecycleService(db, { clock });
    const survivor = db.get('SELECT * FROM runs WHERE run_id = ?', restart.run_id);
    const survivorEvents = db.all('SELECT kind FROM events WHERE run_id = ?', restart.run_id).map(row => String(row['kind']));
    log['restart'] = { child: restart.stdout, child_signal: restart.signal, recovered: survivor,
      events: survivorEvents, outbox: pending(db).length };
    const survivedRestart = restart.signal === 'SIGKILL' && survivor !== undefined &&
      String(survivor['state']) === 'RECEIVED' && survivorEvents.includes('request_received');

    // 6. An expired lease is reassigned with a higher epoch; the old result is refused.
    const attemptRow = service.createAttempt({
      attempt_id: 'attempt_t02', project_id: PROJECT, run_id: first.run_id, task_id: 'task_t02',
      attempt_number: 1, role: 'writer', parent_attempt_id: null, depth: 0, workspace_id: 'ws_t02',
      base_source_digest: `sha256:${'a'.repeat(64)}`, allowed_write_paths: ['src/'], dependency_task_ids: [],
      deadline: '2026-09-07T12:00:30.000Z', provider_session_id: null,
    });
    const leased = await service.claimTask('task_t02', 'worker_one', '2026-09-07T12:00:30.000Z');
    const beforeExpiry = checkFence(db, { attempt_id: attemptRow.attempt_id, lease_epoch: leased.lease_epoch });
    const reconciliation = reconcile(db, '2026-09-08T00:00:00.000Z');
    const reassigned = await service.reassignTask('task_t02', 'worker_two', '2026-09-09T00:00:00.000Z');
    const staleResult = checkFence(db, { attempt_id: attemptRow.attempt_id, lease_epoch: leased.lease_epoch });
    const freshResult = checkFence(db, { attempt_id: attemptRow.attempt_id, lease_epoch: reassigned.lease_epoch });
    log['fencing'] = { first_epoch: leased.lease_epoch, before_expiry: beforeExpiry, reconciliation, reassigned_epoch: reassigned.lease_epoch, stale: staleResult, fresh: freshResult };
    const expiredResultRejected = beforeExpiry.accepted && reassigned.lease_epoch > leased.lease_epoch &&
      !staleResult.accepted && staleResult.reason === 'STALE_LEASE_EPOCH' && freshResult.accepted;

    // 7. Usage, budget and candidate records cannot be attached across runs.
    const otherRun = await service.createRun({ ...request, request_id: 'request_t02_other' }, 'idem-other');
    const usage = await fixture<UsageEvent>('usage', {
      usage_event_id: 'usage_t02', provider_event_id: 'provider_event_t02',
      run_id: otherRun.run_id, attempt_id: attemptRow.attempt_id,
    });
    const crossRunUsage = await attemptAsync(() => service.recordUsage(usage));
    const crossRunBudget = attempt(() => db.run(
      'INSERT INTO budget_reservations (reservation_id, run_id, attempt_id, reserved_microusd, reserved_tokens, verification_reserve, status, created_at) VALUES (?,?,?,?,?,0,?,?)',
      'res_cross', otherRun.run_id, attemptRow.attempt_id, 100, null, 'RESERVED', clock()));
    db.run('INSERT INTO candidates (candidate_id, project_id, run_id, source_digest, artifact_digest, requirements_revision, policy_digest, environment_digest, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      'candidate_t02', PROJECT, first.run_id, `sha256:${'b'.repeat(64)}`, `sha256:${'c'.repeat(64)}`, 1, `sha256:${'d'.repeat(64)}`, `sha256:${'e'.repeat(64)}`, clock());
    const crossRunCandidate = attempt(() => db.run('UPDATE runs SET candidate_id = ? WHERE run_id = ?', 'candidate_t02', otherRun.run_id));
    log['cross_run'] = { usage: crossRunUsage, budget: crossRunBudget, candidate: crossRunCandidate };
    const crossRunRejected = !crossRunUsage.ok && !crossRunBudget.ok && !crossRunCandidate.ok;

    // A duplicate provider event is counted once, and a correctly attached one is stored.
    const ownUsage = { ...usage, run_id: first.run_id };
    const usageFirst = await service.recordUsage(ownUsage);
    const usageAgain = await service.recordUsage({ ...ownUsage, usage_event_id: 'usage_t02_dup' });
    log['usage_dedup'] = { first: usageFirst, again: usageAgain };

    // 8. A late material revision fences every in-flight attempt in the same transaction.
    db.run("UPDATE task_attempts SET status = 'RUNNING' WHERE attempt_id = ?", attemptRow.attempt_id);
    const beforeRevision = checkFence(db, { attempt_id: attemptRow.attempt_id, lease_epoch: reassigned.lease_epoch });
    const scoped = await service.getRun(first.run_id);
    const revised = service.applyRequirementRevision({
      run_id: first.run_id, expected_version: scoped.state_version,
      contract: { ...contract, revision: 2 }, actor: 'controller',
      reason: 'client changed a material requirement mid-run', idempotency_key: 'revision-2',
    });
    const afterRevision = checkFence(db, {
      attempt_id: attemptRow.attempt_id, lease_epoch: reassigned.lease_epoch,
      requirements_revision: scoped.requirements_revision,
    });
    log['revision'] = { before: beforeRevision, revised, after: afterRevision,
      run: db.get('SELECT state, requirements_revision, candidate_id FROM runs WHERE run_id = ?', first.run_id) };
    const lateRevisionFences = beforeRevision.accepted && !afterRevision.accepted &&
      afterRevision.reason === 'ATTEMPT_REVOKED' && revised.fenced_attempts.includes(attemptRow.attempt_id) &&
      revised.revoked_leases.length > 0 && revised.run.requirements_revision === 2 && revised.run.candidate_id === null;

    await evidence.write('lifecycle.json', log);
    await evidence.write('events.json', db.all('SELECT run_id, sequence, kind, created_at FROM events ORDER BY run_id, sequence'));
    await evidence.write('outbox.json', pending(db));

    return {
      scenario_id: 'AT-002',
      mode: 'integration',
      observed: {
        created_run_count: createdRunCount,
        changed_payload_conflict: changedPayloadConflict,
        race_winner_count: raceWinners,
        acknowledged_run_survived_restart: survivedRestart,
        expired_result_rejected: expiredResultRejected,
        precontract_pause_block_cancel_persist: precontractPersist,
        cross_run_usage_budget_and_candidate_rejected: crossRunRejected,
        late_revision_fences_stale_attempt: lateRevisionFences,
        second_connection_lost_race: rogueChanges === 0,
        race_loser_reason: raceLoser && !raceLoser.ok ? raceLoser.code : 'NONE',
        duplicate_usage_counted_once: usageFirst === 'inserted' && usageAgain === 'duplicate',
      } satisfies Record<string, Json>,
      artifact_paths: evidence.paths,
    };
  } finally {
    db.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});
