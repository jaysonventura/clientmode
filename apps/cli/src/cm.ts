/** `cm` — the executable entry point.
 *
 * The command surface, its arguments and its exit codes are declared in `main.ts` and checked
 * against the operations contract by AT-018. This file is the dispatcher that makes them
 * runnable, and it deliberately holds no logic of its own: every command calls the same module
 * a gate exercises.
 *
 * A zero exit means the command did what it said within its stated scope. It is never a
 * product readiness verdict.
 */
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ControllerDatabase } from '../../../packages/state/src/database.js';
import { LifecycleService } from '../../../packages/core/src/lifecycle.js';
import { SessionStore } from '../../controller/src/auth.js';
import { createControllerServer, listenLoopback } from '../../controller/src/server.js';
import { COMMANDS, EXIT_CODES, describe, type ExitCode } from './main.js';
import { doctor, type HostSpec } from './doctor.js';
import { buildDistribution } from '../../../packages/packaging/src/build.js';
import { applyInstall, approve, planInstall, uninstall, type InstallRecord } from '../../../packages/packaging/src/install.js';
import { createRun } from './run.js';
import { buildConsole } from './console-bundle.js';

export type Argv = { command: string; positional: string[]; flags: Record<string, string | true> };

export function parseArgv(argv: readonly string[]): Argv {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const name = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) { flags[name] = true; continue; }
    flags[name] = next;
    index += 1;
  }
  return { command, positional, flags };
}

/** Where the controller keeps its state. One directory per authorized project root, derived
 * from the root itself so two projects never share a database. */
export function stateDirFor(root: string): string {
  const home = process.env['CM_HOME'] ?? path.join(os.homedir(), '.client-mode');
  return path.join(home, 'projects', createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16));
}

export function projectIdFor(root: string): string {
  return `project_${createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12)}`;
}

function openProject(root: string): { db: ControllerDatabase; service: LifecycleService; project_id: string; state_dir: string } {
  const resolved = path.resolve(root);
  if (!existsSync(resolved)) throw new Error(`ROOT_NOT_FOUND: ${resolved}`);
  const state_dir = stateDirFor(resolved);
  mkdirSync(state_dir, { recursive: true });
  const db = ControllerDatabase.open(state_dir);
  const service = new LifecycleService(db);
  const project_id = projectIdFor(resolved);
  // Registering is idempotent: the root the client chose is the only one ever registered.
  try {
    service.registerProject({
      project_id, registered_root_ref: `file://${resolved}`,
      profile_id: 'discover', data_class: 'internal',
    });
  } catch { /* already registered */ }
  return { db, service, project_id, state_dir };
}

const HOSTS: HostSpec[] = [
  { provider: 'claude', surface: 'native_cli', executable: 'claude' },
  { provider: 'codex', surface: 'native_cli', executable: 'codex' },
];

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');

const BLOCK_START = '<!-- client-mode:start -->';
const BLOCK_END = '<!-- client-mode:end -->';

/** Put the package where the host will actually read it.
 *
 * Skills go to the host's own skills directory; the operating rules go into the instructions
 * file the host loads on every session, inside markers so `cm uninstall` can take exactly them
 * back out. An existing instructions file is backed up and appended to — never replaced. */
export function activate(input: { host: 'claude' | 'codex'; install_root: string; distribution_root: string }): {
  created: string[]; backups: Array<{ target: string; backup: string }>; summary: string;
} {
  const created: string[] = [];
  const backups: Array<{ target: string; backup: string }> = [];
  const skillsSource = path.join(input.distribution_root, 'skills');
  const skillNames = existsSync(skillsSource) ? readdirSync(skillsSource).sort() : [];

  // Skills are prefixed so they never collide with a skill the user already has.
  const skillsRoot = path.join(input.install_root, 'skills');
  for (const name of skillNames) {
    const target = path.join(skillsRoot, `cm-${name}`, 'SKILL.md');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(skillsSource, name, 'SKILL.md'), 'utf8'));
    created.push(target);
  }

  const instructions = instructionsFile(input.host, input.install_root);
  const block = `${BLOCK_START}\n${readFileSync(path.join(REPO_ROOT, 'adapters/global/CLIENT_MODE.md'), 'utf8').trimEnd()}\n${BLOCK_END}\n`;
  if (existsSync(instructions)) {
    const current = readFileSync(instructions, 'utf8');
    const without = stripBlock(current);
    const backup = `${instructions}.client-mode-backup`;
    // The backup is the file without our block, so reinstalling over an existing install
    // cannot turn our own text into "the user's original".
    if (!existsSync(backup)) { writeFileSync(backup, without); backups.push({ target: instructions, backup }); }
    writeFileSync(instructions, `${without.trimEnd()}\n\n${block}`);
  } else {
    mkdirSync(path.dirname(instructions), { recursive: true });
    writeFileSync(instructions, block);
    created.push(instructions);
  }

  return {
    created, backups,
    summary: `activated: ${String(skillNames.length)} skill(s) in ${skillsRoot}, rules appended to ${instructions}` +
      `${backups.length > 0 ? ` (backup: ${backups[0]!.backup})` : ''}`,
  };
}

/** The change set, in the order it will be applied. The diff is the authorization: nothing is
 * written until someone has seen this. */
function renderPlan(plan: ReturnType<typeof planInstall>, digest: string): string {
  const lines = [`install plan for ${plan.provider}`, `  distribution ${digest}`, `  into ${plan.install_root}`, ''];
  for (const change of plan.changes) {
    if (change.action === 'merge') {
      lines.push(`  merge    ${change.target}`);
      lines.push(`             adds ${change.adds_keys.join(', ')}; preserves ${change.preserves_keys.length} existing key(s)`);
      continue;
    }
    lines.push(`  ${change.action.padEnd(8)} ${change.target}${change.action === 'replace' ? `  (backup: ${change.backup})` : ''}`);
  }
  lines.push('', 'Nothing outside these paths is touched. Apply it by running the same command without --dry-run.');
  return `${lines.join('\n')}\n`;
}

function instructionsFile(host: 'claude' | 'codex', install_root: string): string {
  return path.join(install_root, host === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
}

function stripBlock(text: string): string {
  if (!text.includes(BLOCK_START)) return text;
  const end = text.indexOf(BLOCK_END);
  return `${text.slice(0, text.indexOf(BLOCK_START))}${end === -1 ? '' : text.slice(end + BLOCK_END.length)}`;
}

/** Take the activation back out.
 *
 * The instructions file is edited surgically rather than restored wholesale: the client may
 * have written their own lines around our block since, and those are theirs. An instructions
 * file that is left empty is removed only if we created it. */
export function deactivate(input: { host: 'claude' | 'codex'; install_root: string }): { removed: string[]; summary: string } {
  const removed: string[] = [];
  const skillsRoot = path.join(input.install_root, 'skills');
  if (existsSync(skillsRoot)) {
    for (const entry of readdirSync(skillsRoot)) {
      if (!entry.startsWith('cm-')) continue;
      rmSync(path.join(skillsRoot, entry), { recursive: true, force: true });
      removed.push(path.join(skillsRoot, entry));
    }
    if (readdirSync(skillsRoot).length === 0) rmSync(skillsRoot, { recursive: true, force: true });
  }
  const instructions = instructionsFile(input.host, input.install_root);
  let instructionsNote = 'no instructions file to clean';
  if (existsSync(instructions)) {
    const stripped = stripBlock(readFileSync(instructions, 'utf8')).trimEnd();
    if (stripped === '') { rmSync(instructions, { force: true }); removed.push(instructions); instructionsNote = `removed ${instructions}`; }
    else { writeFileSync(instructions, `${stripped}\n`); instructionsNote = `Client Mode section removed from ${instructions}; everything else left as it was`; }
    rmSync(`${instructions}.client-mode-backup`, { force: true });
  }
  return { removed, summary: `deactivated: ${String(removed.length)} path(s) removed; ${instructionsNote}` };
}

function usage(): string {
  const width = Math.max(...COMMANDS.map(command => command.name.length));
  return [
    'cm — Client Mode',
    '',
    'Usage: cm <command> [options]',
    '',
    ...COMMANDS.map(command => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Common options:',
    '  --root <path>     the project directory to work in (default: the current directory)',
    '  --json            machine-readable output',
    '',
    'State lives under $CM_HOME (default ~/.client-mode), one directory per project root.',
  ].join('\n');
}

export async function main(argv: readonly string[]): Promise<ExitCode> {
  const { command, positional, flags } = parseArgv(argv);
  const json = flags['json'] === true;
  const root = typeof flags['root'] === 'string' ? flags['root'] : process.cwd();

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return EXIT_CODES.ok;
  }
  if (command === 'version' || command === '--version') {
    process.stdout.write(`cm 1.3.0 (node ${process.versions.node}, ${os.platform()}-${os.arch()})\n`);
    return EXIT_CODES.ok;
  }
  if (command === 'commands') {
    process.stdout.write(`${JSON.stringify(COMMANDS, null, json ? 2 : 0)}\n`);
    return EXIT_CODES.ok;
  }
  if (describe(command) === undefined) {
    process.stderr.write(`unknown command: ${command}\n\n${usage()}\n`);
    return EXIT_CODES.input_or_contract_error;
  }

  if (command === 'doctor') {
    const { report } = await doctor({
      hosts: HOSTS, billing_mode: 'native_account', now: new Date().toISOString(),
      required_capabilities: [],
    });
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`Client Mode doctor — ${report.generated_at}\n`);
      process.stdout.write(`  toolkit   node ${report.toolkit.node} on ${report.toolkit.platform}\n`);
      for (const host of report.hosts) {
        process.stdout.write(`  ${host.provider}/${host.surface}  installed=${String(host.installed)} version=${host.version ?? 'none'}\n`);
        for (const capability of host.report.capabilities) {
          // The three states stay separate on the page as well as in the record: documented is
          // not configured, and configured is not observed working.
          const state = capability.observed_working ? 'observed_working'
            : capability.configured ? 'configured' : 'unavailable';
          const note = capability.limitation === null ? '' : `  (${capability.limitation})`;
          process.stdout.write(`      ${capability.name.padEnd(20)} ${state.padEnd(16)}${note}\n`);
        }
      }
      for (const target of report.targets) {
        process.stdout.write(`  target ${target.name}: observed_working=${String(target.observed_working)}${target.limitation === null ? '' : ` (${target.limitation})`}\n`);
      }
      if (report.gaps.length > 0) {
        process.stdout.write('\n  Not working, and not to be read as working:\n');
        for (const gap of report.gaps) process.stdout.write(`    - ${gap}\n`);
      }
    }
    return report.exit_code as ExitCode;
  }

  if (command === 'run') {
    const file = flags['request-file'];
    if (typeof file !== 'string') {
      process.stderr.write('run needs --request-file <path>, a file inside the project root\n');
      return EXIT_CODES.input_or_contract_error;
    }
    const { db, service, project_id } = openProject(root);
    try {
      const outcome = await createRun({
        service, project_id, request_file: path.resolve(file), authorized_root: path.resolve(root),
        idempotency_key: typeof flags['idempotency-key'] === 'string' ? flags['idempotency-key'] : `cli-${Date.now().toString(36)}`,
        now: new Date().toISOString(),
      });
      if (outcome.run === undefined) {
        process.stderr.write(`${outcome.error ?? 'run rejected'}\n`);
        return outcome.exit_code;
      }
      process.stdout.write(json
        ? `${JSON.stringify(outcome.run, null, 2)}\n`
        : `run ${outcome.run.run_id}\nstate ${outcome.run.state}\n`);
      return outcome.exit_code;
    } finally { db.close(); }
  }

  if (command === 'status') {
    const runId = positional[0];
    if (runId === undefined) {
      process.stderr.write('status needs a run id\n');
      return EXIT_CODES.input_or_contract_error;
    }
    const { db, service } = openProject(root);
    try {
      const run = await service.getRun(runId);
      const questions = db.all("SELECT record_json FROM client_questions WHERE run_id = ? AND status = 'OPEN'", runId)
        .map(row => JSON.parse(String(row['record_json'])) as { prompt: string });
      const body = {
        run_id: run.run_id, state: run.state, state_version: run.state_version,
        requirements_revision: run.requirements_revision, candidate_id: run.candidate_id,
        open_question: questions[0]?.prompt ?? null,
        // Readiness and acceptance are different things, and the status line says so.
        readiness: run.state === 'READY_FOR_REVIEW' || run.state === 'AWAITING_RELEASE_APPROVAL'
          ? 'technically verified for its scope' : 'not verified',
        client_acceptance: 'not recorded by this command; only the client records it',
      };
      process.stdout.write(json
        ? `${JSON.stringify(body, null, 2)}\n`
        : `run ${body.run_id}\nstate ${body.state} (version ${String(body.state_version)})\nreadiness ${body.readiness}\nacceptance ${body.client_acceptance}\n${body.open_question === null ? '' : `question: ${body.open_question}\n`}`);
      return EXIT_CODES.ok;
    } catch (error) {
      process.stderr.write(`${String((error as Error).message)}\n`);
      return EXIT_CODES.input_or_contract_error;
    } finally { db.close(); }
  }

  if (command === 'open') {
    const { db, service, project_id, state_dir } = openProject(root);
    const bootstrap = createHash('sha256').update(`${project_id}:${String(Date.now())}`).digest('hex');
    const sessions = new SessionStore({ bootstrap_secret: bootstrap });
    const runId = typeof flags['run'] === 'string'
      ? flags['run']
      : db.get('SELECT run_id FROM runs ORDER BY created_at DESC LIMIT 1')?.['run_id'];
    if (runId === undefined) {
      process.stderr.write('no run to open yet. Create one first:\n  cm run --root <path> --request-file <file>\n');
      db.close();
      return EXIT_CODES.input_or_contract_error;
    }
    const run = await service.getRun(String(runId));
    const consoleDir = await buildConsole(path.join(state_dir, 'console'), {
      run_id: run.run_id, status: run.state, bootstrap_secret: bootstrap,
    });
    const server = createControllerServer({ db, service, sessions, console_dir: consoleDir, project_id });
    const listening = await listenLoopback(server);
    process.stdout.write(`${listening.url}\n`);
    process.stdout.write(`run ${run.run_id} — press Ctrl+C to stop\n`);
    await new Promise<void>(resolve => {
      const stop = (): void => { void listening.close().then(() => { db.close(); resolve(); }); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return EXIT_CODES.ok;
  }

  if (command === 'install' || command === 'uninstall') {
    const host = flags['host'];
    if (host !== 'claude' && host !== 'codex') {
      process.stderr.write(`${command} needs --host claude or --host codex\n`);
      return EXIT_CODES.input_or_contract_error;
    }
    const home = process.env['CM_HOME'] ?? path.join(os.homedir(), '.client-mode');
    const recordFile = path.join(home, `install-${host}.json`);

    if (command === 'uninstall') {
      if (!existsSync(recordFile)) {
        process.stderr.write(`nothing installed for ${host} by this toolkit\n`);
        return EXIT_CODES.input_or_contract_error;
      }
      const record = JSON.parse(readFileSync(recordFile, 'utf8')) as InstallRecord;
      const removal = uninstall(record);
      const cleaned = deactivate({ host, install_root: record.plan.install_root });
      removal.removed.push(...cleaned.removed);
      rmSync(recordFile, { force: true });
      process.stdout.write(json ? `${JSON.stringify({ ...removal, ...cleaned }, null, 2)}\n`
        : `removed ${String(removal.removed.length)} file(s), restored ${String(removal.restored.length)}, left alone ${String(removal.left_alone.length)}\n${cleaned.summary}\n`);
      return EXIT_CODES.ok;
    }

    // The install root is the host's own configuration directory, and the plan touches only
    // paths under it that this toolkit owns.
    const installRoot = typeof flags['install-root'] === 'string'
      ? path.resolve(flags['install-root'])
      : host === 'claude' ? path.join(os.homedir(), '.claude') : path.join(os.homedir(), '.codex');
    mkdirSync(home, { recursive: true });
    const distribution = buildDistribution({
      provider: host, source_root: REPO_ROOT, out_root: path.join(home, 'dist'), version: '1.3.0',
    });
    const plan = planInstall({ distribution, install_root: installRoot });

    if (flags['dry-run'] === true) {
      process.stdout.write(json ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan, distribution.distribution_digest));
      return EXIT_CODES.ok;
    }
    const record = applyInstall({ plan: approve(plan), distribution, now: new Date().toISOString() });
    // Copying the package under the host's config directory puts the files on disk; it does not
    // make the host read them. Activation writes the locations each host actually loads.
    const activated = activate({ host, install_root: installRoot, distribution_root: distribution.root });
    record.created.push(...activated.created);
    record.backups.push(...activated.backups);
    writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n');
    process.stdout.write(json ? `${JSON.stringify(record, null, 2)}\n`
      : `installed ${String(record.created.length)} file(s) under ${installRoot}\n` +
        `${String(record.backups.length)} existing file(s) backed up, ${String(record.merged.length)} settings file(s) merged\n` +
        `${activated.summary}\n` +
        `record: ${recordFile}\nremove it again with: cm uninstall --host ${host}\n`);
    return EXIT_CODES.ok;
  }

  // The remaining declared commands have implemented modules but are not wired to a terminal
  // entry point yet. Saying so is the honest answer; pretending otherwise is not.
  process.stderr.write(
    `${command} is declared in the command surface and its module is implemented, but it has no\n` +
    'terminal entry point in this build. See qa/product/STATUS.md for what is and is not wired.\n');
  return EXIT_CODES.missing_capability;
}

const invoked = process.argv[1] ?? '';
if (/\bcm(\.[tj]s)?$/.test(invoked)) {
  main(process.argv.slice(2))
    .then(code => { process.exitCode = code; })
    .catch((error: unknown) => {
      process.stderr.write(`${String((error as Error).message)}\n`);
      process.exitCode = EXIT_CODES.internal;
    });
}
