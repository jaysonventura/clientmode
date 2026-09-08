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
import { mkdirSync, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ControllerDatabase } from '../../../packages/state/src/database.js';
import { LifecycleService } from '../../../packages/core/src/lifecycle.js';
import { SessionStore } from '../../controller/src/auth.js';
import { createControllerServer, listenLoopback } from '../../controller/src/server.js';
import { COMMANDS, EXIT_CODES, describe, type ExitCode } from './main.js';
import { buildHandoff, endSession, renderHandoff, startSession } from '../../../packages/core/src/handoff.js';
import { doctor, type HostSpec } from './doctor.js';
import { buildDistribution } from '../../../packages/packaging/src/build.js';
import { applyInstall, approve, planInstall, uninstall, type InstallRecord } from '../../../packages/packaging/src/install.js';
import { cancelRun, createRun } from './run.js';
import { rejectsCallerCommand } from './verify.js';
import { assessRollback, restore, upgrade } from '../../../packages/packaging/src/upgrade.js';
import { redactValue } from '../../../packages/observability/src/redaction.js';
import { toolkitRoot } from '../../../packages/contracts/src/toolkit-root.js';

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

/** The canonical path of a folder.
 *
 * On macOS `/tmp` is a symlink into `/private/tmp`, so the same folder reached two ways would
 * otherwise hash to two different projects — and a session started one way would not see the
 * work left by a session started the other. Continuity depends on this being one answer. */
export function canonicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try { return realpathSync(resolved); } catch { return resolved; }
}

/** Where the controller keeps its state. One directory per authorized project root, derived
 * from the root itself so two projects never share a database. */
export function stateDirFor(root: string): string {
  const home = process.env['CM_HOME'] ?? path.join(os.homedir(), '.client-mode');
  return path.join(home, 'projects', createHash('sha256').update(canonicalRoot(root)).digest('hex').slice(0, 16));
}

export function projectIdFor(root: string): string {
  return `project_${createHash('sha256').update(canonicalRoot(root)).digest('hex').slice(0, 12)}`;
}

/** Open a project's state.
 *
 * `exclusive` is for the one process that owns the run loop — `cm open`. Everything else is a
 * short-lived reader or an idempotent writer, and two of those at once is a normal thing for a
 * person with two terminals to do. */
function openProject(root: string, options: { exclusive?: boolean } = {}):
  { db: ControllerDatabase; service: LifecycleService; project_id: string; state_dir: string } {
  const resolved = canonicalRoot(root);
  if (!existsSync(resolved)) throw new Error(`ROOT_NOT_FOUND: ${resolved}`);
  const state_dir = stateDirFor(resolved);
  mkdirSync(state_dir, { recursive: true });
  const db = ControllerDatabase.open(state_dir, { exclusive: options.exclusive === true });
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

export type Preference = { preferred_host: 'claude' | 'codex' };

function configFile(): string {
  return path.join(process.env['CM_HOME'] ?? path.join(os.homedir(), '.client-mode'), 'config.json');
}

export function readPreference(): Preference | null {
  const file = configFile();
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Preference>;
    return parsed.preferred_host === 'claude' || parsed.preferred_host === 'codex'
      ? { preferred_host: parsed.preferred_host } : null;
  } catch { return null; }
}

export function writePreference(host: 'claude' | 'codex'): string {
  const file = configFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
  writeFileSync(file, JSON.stringify({ ...current, preferred_host: host }, null, 2) + '\n');
  return file;
}

function onPath(executable: string): boolean {
  try { execFileSync('/usr/bin/which', [executable], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Which host a bare `cm` should start: the stated preference if it is installed, otherwise the
 * only one that is. Two installed hosts and no preference is a question, not a guess. */
export function chooseHost(input: { requested?: string; preference: Preference | null; installed: string[] }):
  | { host: 'claude' | 'codex'; why: string }
  | { host: null; reason: string } {
  if (input.requested !== undefined) {
    if (input.requested !== 'claude' && input.requested !== 'codex') return { host: null, reason: `unknown host: ${input.requested}` };
    if (!input.installed.includes(input.requested)) return { host: null, reason: `${input.requested} is not installed on this machine` };
    return { host: input.requested, why: 'asked for on the command line' };
  }
  const preferred = input.preference?.preferred_host;
  if (preferred !== undefined && input.installed.includes(preferred)) return { host: preferred, why: 'your saved preference' };
  if (preferred !== undefined) return { host: null, reason: `your preferred host (${preferred}) is not installed on this machine` };
  if (input.installed.length === 1) return { host: input.installed[0] as 'claude' | 'codex', why: 'the only host installed' };
  if (input.installed.length === 0) return { host: null, reason: 'neither claude nor codex is installed' };
  return { host: null, reason: 'both claude and codex are installed and no preference is saved' };
}

const HOSTS: HostSpec[] = [
  { provider: 'claude', surface: 'native_cli', executable: 'claude' },
  { provider: 'codex', surface: 'native_cli', executable: 'codex' },
];

const REPO_ROOT = toolkitRoot();

/** Pause stops new work being dispatched. It does not reach into a provider's own queue, and
 * saying otherwise would be the one thing this command must never claim. */
const PAUSE_NOTE = 'New work is not dispatched. Work already in flight with a provider is not ' +
  'reached by this command; nothing here claims it stopped.';

const BLOCK_START = '<!-- client-mode:start -->';
const BLOCK_END = '<!-- client-mode:end -->';

/** Put the package where the host will actually read it.
 *
 * Skills go to the host's own skills directory; the operating rules go into the instructions
 * file the host loads on every session, inside markers so `cm uninstall` can take exactly them
 * back out. An existing instructions file is backed up and appended to — never replaced. */
export function activate(input: {
  host: 'claude' | 'codex'; install_root: string; distribution_root: string;
  /** Lead mode puts Client Mode first and treats whatever was already there as reference. */
  lead?: boolean;
}): {
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
  const source = input.lead === true ? 'adapters/global/CLIENT_MODE_LEAD.md' : 'adapters/global/CLIENT_MODE.md';
  const block = `${BLOCK_START}\n${readFileSync(path.join(REPO_ROOT, source), 'utf8').trimEnd()}\n${BLOCK_END}\n`;
  if (existsSync(instructions)) {
    const current = readFileSync(instructions, 'utf8');
    const without = stripBlock(current).trimEnd();
    const backup = `${instructions}.client-mode-backup`;
    // The backup is the file without our block, so reinstalling over an existing install
    // cannot turn our own text into "the user's original".
    if (!existsSync(backup)) { writeFileSync(backup, `${without}\n`); backups.push({ target: instructions, backup }); }
    // Lead mode goes first and says so; nothing that was there is deleted.
    writeFileSync(instructions, input.lead === true ? `${block}\n${without}\n` : `${without}\n\n${block}`);
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
  const without = `${text.slice(0, text.indexOf(BLOCK_START))}${end === -1 ? '' : text.slice(end + BLOCK_END.length)}`;
  // Installing and removing repeatedly must not leave a growing gap where the block used to be.
  return without.replace(/\n{3,}/g, '\n\n').trim();
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
    'Usage: cm                     start your preferred host here, with Client Mode loaded',
    '       cm use <claude|codex>  choose which host a bare `cm` starts',
    '       cm <command> [options]',
    '',
    ...COMMANDS.map(command => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Common options:',
    '  --root <path>     the project directory to work in (default: the current directory)',
    '  --json            machine-readable output',
    '  --lead            (install) put Client Mode first, ahead of any existing instructions',
    '  --bin-dir <path>  (install) where to write the `cm` launcher (default: ~/.local/bin)',
    '  --no-portable     (install) skip the portable toolkit; run from this checkout instead',
    '  --dry-run         (install) print the change set and write nothing',
    '',
    'State lives under $CM_HOME (default ~/.client-mode), one directory per project root.',
  ].join('\n');
}

export async function main(argv: readonly string[]): Promise<ExitCode> {
  const { command, positional, flags } = parseArgv(argv);
  const json = flags['json'] === true;
  // The launcher runs node from the toolkit directory so its dependencies resolve; the folder
  // the client actually invoked `cm` in arrives in CM_CWD.
  const root = typeof flags['root'] === 'string' ? flags['root'] : (process.env['CM_CWD'] ?? process.cwd());

  // A bare `cm` in a project folder starts the preferred host there, with Client Mode already
  // loaded from the global instructions. `cm help` is how you get the command list.
  // A bare `cm` in a project folder starts the preferred host there, with Client Mode loaded
  // and a briefing from whatever the last session left behind — whichever host that was.
  // A leading flag means the whole argv is for the host, not for us.
  // Anything that is not one of our own commands belongs to the host: `cm exec ...`,
  // `cm --resume`, `cm "fix the checkout"`. A launcher that swallowed those would be a worse
  // way to reach the host than typing its name.
  const OURS = new Set(['help', '--help', '-h', 'version', '--version', 'commands', 'use', 'start', 'handoff']);
  const passthroughOnly = !OURS.has(command) && describe(command) === undefined;
  if (command === 'start' || argv.length === 0 || passthroughOnly) {
    const installed = (['claude', 'codex'] as const).filter(onPath);
    const chosen = chooseHost({
      ...(typeof flags['host'] === 'string' && !passthroughOnly ? { requested: flags['host'] } : {}),
      preference: readPreference(), installed,
    });
    if (chosen.host === null) {
      process.stderr.write(`${chosen.reason}.\n`);
      if (installed.length > 1) process.stderr.write('Pick one: cm use claude   |   cm use codex\n');
      return EXIT_CODES.missing_capability;
    }
    const resolved = canonicalRoot(root);
    const hostArgv = passthroughOnly ? [...argv] : positional.filter(token => token !== 'start');

    let session: { session_id: string } | null = null;
    let brief = '';
    let briefFile = '';
    let db: ControllerDatabase | null = null;
    try {
      const opened = openProject(resolved);
      db = opened.db;
      const handoff = buildHandoff(db, { project_id: opened.project_id, working_directory: resolved, at: new Date().toISOString() });
      // The briefing is written where both hosts and the client can read it, and passed to the
      // host only when the client did not bring their own opening prompt.
      briefFile = path.join(opened.state_dir, 'HANDOFF.md');
      brief = renderHandoff(handoff);
      writeFileSync(briefFile, brief);
      session = startSession(db, { project_id: opened.project_id, host: chosen.host, working_directory: resolved, at: new Date().toISOString() });
      if (!handoff.nothing_in_progress) {
        const next = handoff.runs[0]?.next_task;
        process.stderr.write(
          `Continuing work left by ${handoff.previous?.host ?? 'an earlier session'} — ${String(handoff.runs.length)} run(s) open` +
          `${next === undefined || next === null ? '' : `, next task: ${next.task_id} (${next.title})`}.\n`);
        // The briefing is context, not the client's prompt. Claude Code takes it as an appended
        // system prompt so it is present whether or not the client typed something; Codex has no
        // such flag, so it is prepended to the prompt with a rule between.
        if (chosen.host === 'claude') {
          hostArgv.push('--append-system-prompt-file', briefFile);
        } else if (hostArgv.length === 0) {
          // Codex has no flag for appended instructions, so a bare `cm` opens with the briefing
          // as its first message. When the client brought their own command, their argv is left
          // exactly as they wrote it — rewriting someone's arguments is how a flag value ends up
          // with a briefing pasted into it — and the session reads the briefing itself.
          hostArgv.push(brief);
        }
        process.stderr.write(`Briefing: ${briefFile}  (or run \`cm handoff\`)\n`);
      }
    } catch (error) {
      process.stderr.write(`(no project state: ${String((error as Error).message)})\n`);
    }

    process.stderr.write(`Client Mode → ${chosen.host} in ${resolved}  (${chosen.why})\n`);
    const result = spawnSync(chosen.host, hostArgv, { stdio: 'inherit', cwd: resolved });
    if (db !== null) {
      if (session !== null) endSession(db, { session_id: session.session_id, at: new Date().toISOString(), exit_code: result.status });
      db.close();
    }
    return (result.status ?? EXIT_CODES.internal) as ExitCode;
  }

  if (command === 'handoff') {
    const { db, project_id, state_dir } = openProject(root);
    try {
      const handoff = buildHandoff(db, { project_id, working_directory: path.resolve(root), at: new Date().toISOString() });
      const text = renderHandoff(handoff);
      writeFileSync(path.join(state_dir, 'HANDOFF.md'), text);
      process.stdout.write(json ? `${JSON.stringify(handoff, null, 2)}\n` : text);
      return EXIT_CODES.ok;
    } finally { db.close(); }
  }

  if (command === 'use') {
    const host = positional[0] ?? (typeof flags['host'] === 'string' ? flags['host'] : undefined);
    if (host !== 'claude' && host !== 'codex') {
      process.stderr.write('use needs a host: cm use claude   |   cm use codex\n');
      return EXIT_CODES.input_or_contract_error;
    }
    const file = writePreference(host);
    process.stdout.write(`${host} is now the host a bare \`cm\` starts.\nsaved in ${file}\n`);
    return EXIT_CODES.ok;
  }

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
      const questions = db.all("SELECT prompt FROM client_questions WHERE run_id = ? AND status = 'OPEN'", runId)
        .map(row => ({ prompt: String(row['prompt']) }));
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


  if (command === 'pause' || command === 'resume' || command === 'cancel') {
    const runId = positional[0];
    if (runId === undefined) {
      process.stderr.write(`${command} needs a run id\n`);
      return EXIT_CODES.input_or_contract_error;
    }
    const { db, service } = openProject(root);
    try {
      const run = await service.getRun(runId);
      if (command === 'cancel') {
        // Recording the intent is ours and is immediate. Whether a process tree actually
        // stopped depends on processes we do not own, and is reported separately.
        const outcome = cancelRun({ service, run_id: runId });
        process.stdout.write(json ? `${JSON.stringify(outcome, null, 2)}\n`
          : `cancel recorded in ${outcome.acknowledged_in_ms.toFixed(1)} ms\n` +
            `${String(outcome.leases_revoked.length)} lease(s) revoked\n` +
            `process tree: ${outcome.tree === null ? 'not checked by this command — nothing here claims it stopped' : `terminated=${String(outcome.tree.terminated)}`}\n`);
        return outcome.exit_code;
      }
      if (command === 'pause') {
        const intent = service.requestControl({ run_id: runId, action: 'pause', actor: 'controller', reason: 'cm pause' });
        process.stdout.write(json ? `${JSON.stringify({ ...intent, note: PAUSE_NOTE }, null, 2)}\n`
          : `pause recorded (${intent.intent_id})\n${String(intent.leases_revoked.length)} lease(s) revoked\n${PAUSE_NOTE}\n`);
        return EXIT_CODES.ok;
      }
      // resume: report the phase the controller can actually resume from, and nothing beyond it.
      const phase = service.resumePhase(runId);
      process.stdout.write(json ? `${JSON.stringify({ ...phase, from_state: run.state }, null, 2)}\n`
        : `resumable: ${String(phase.resumable)}\nphase: ${phase.phase}\nwhy: ${phase.reason}\n` +
          'Nothing above is progress; it is the state that was recorded before the interruption.\n');
      return phase.resumable ? EXIT_CODES.ok : EXIT_CODES.budget_or_no_progress;
    } catch (error) {
      process.stderr.write(`${String((error as Error).message)}\n`);
      return EXIT_CODES.input_or_contract_error;
    } finally { db.close(); }
  }

  if (command === 'verify') {
    const candidateId = flags['candidate'];
    if (typeof candidateId !== 'string') {
      process.stderr.write('verify needs --candidate <id>\n');
      return EXIT_CODES.input_or_contract_error;
    }
    // The caller names a candidate and nothing else. A command string in the request is
    // refused before anything is looked up.
    if (rejectsCallerCommand({ candidate: candidateId, ...flags })) {
      process.stderr.write('CALLER_SUPPLIED_COMMAND_REFUSED: verify takes a candidate id, never a command\n');
      return EXIT_CODES.integrity_or_security;
    }
    const { db } = openProject(root);
    try {
      const row = db.get('SELECT * FROM candidates WHERE candidate_id = ?', candidateId);
      if (row === undefined) {
        process.stderr.write(`no such candidate in this project: ${candidateId}\n`);
        return EXIT_CODES.input_or_contract_error;
      }
      const authority = path.join(os.homedir(), '.client-mode', 'verifier-authority');
      if (!existsSync(authority)) {
        process.stderr.write('no protected verification authority is configured on this machine.\n' +
          'Verification is refused rather than performed by the caller.\n');
        return EXIT_CODES.missing_capability;
      }
      process.stdout.write(`candidate ${candidateId} is registered; request the protected checks through the controller\n`);
      return EXIT_CODES.ok;
    } finally { db.close(); }
  }

  if (command === 'export-evidence') {
    const candidateId = flags['candidate'];
    if (typeof candidateId !== 'string') {
      process.stderr.write('export-evidence needs --candidate <id>\n');
      return EXIT_CODES.input_or_contract_error;
    }
    const { db } = openProject(root);
    try {
      const rows = db.all('SELECT * FROM evidence_references WHERE candidate_id = ? ORDER BY received_at', candidateId);
      if (rows.length === 0) {
        process.stderr.write(`no evidence recorded for ${candidateId}\n`);
        return EXIT_CODES.input_or_contract_error;
      }
      // Everything leaving the controller goes through redaction, and any retention lock is
      // stated rather than silently dropping a record.
      const held = rows.filter(row => row['retention_hold'] !== null && row['retention_hold'] !== undefined);
      const exported = rows.map(row => redactValue(row));
      process.stdout.write(`${JSON.stringify({ candidate_id: candidateId, records: exported, under_retention_hold: held.length }, null, 2)}\n`);
      if (held.length > 0) process.stderr.write(`${String(held.length)} record(s) are under a retention hold and are exported with that stated.\n`);
      return EXIT_CODES.ok;
    } finally { db.close(); }
  }

  if (command === 'upgrade' || command === 'rollback') {
    const { db, state_dir } = openProject(root);
    db.close();
    const statePath = path.join(state_dir, 'state.sqlite');
    const backupDir = path.join(state_dir, 'backups');
    const version = typeof flags['version'] === 'string' ? flags['version']
      : typeof flags['toolkit-version'] === 'string' ? flags['toolkit-version'] : null;
    if (command === 'upgrade') {
      if (version === null) {
        process.stderr.write('upgrade needs --version <version>\n');
        return EXIT_CODES.input_or_contract_error;
      }
      // Snapshot, migrate, then activate. There are no pending migrations in this build, so
      // the honest outcome is a snapshot and an activation, not a claim of having migrated.
      const outcome = upgrade({
        state_path: statePath, config_path: null, backup_dir: backupDir,
        from_version: '1.3.0', to_version: version, migrations: [],
        activate: () => undefined, now: new Date().toISOString(),
      });
      process.stdout.write(json ? `${JSON.stringify(outcome, null, 2)}\n`
        : `${outcome.upgraded ? 'upgraded' : 'not upgraded'} ${outcome.from} → ${outcome.to}\n` +
          `state snapshot: ${outcome.snapshot.state_backup}\n` +
          `${outcome.upgraded ? `${String(outcome.applied_migrations.length)} migration(s) applied` : outcome.reason}\n`);
      return outcome.upgraded ? EXIT_CODES.ok : EXIT_CODES.internal;
    }
    if (typeof flags['deployment'] === 'string') {
      // A deployment rollback is an authorized operation in its own right.
      if (typeof flags['approval'] !== 'string') {
        process.stderr.write('rolling back a deployment needs --approval <id>: a rollback is an authorized action, not a retry\n');
        return EXIT_CODES.authorization_required;
      }
      process.stderr.write('deployment rollback runs through the release authority, which is not configured on this machine\n');
      return EXIT_CODES.missing_capability;
    }
    if (!existsSync(backupDir) || readdirSync(backupDir).length === 0) {
      process.stderr.write('no snapshot to roll back to. A rollback restores a snapshot; it does not reconstruct one.\n');
      return EXIT_CODES.input_or_contract_error;
    }
    const snapshots = readdirSync(backupDir).filter(entry => entry.endsWith('.sqlite')).sort();
    const chosen = snapshots[snapshots.length - 1]!;
    const assessment = assessRollback([], { taken_at: '', state_backup: path.join(backupDir, chosen), config_backup: null, from_version: version ?? 'unknown' });
    if (!assessment.rollback_safe) {
      process.stderr.write(`${assessment.reason}: ${assessment.guidance}\n`);
      return EXIT_CODES.integrity_or_security;
    }
    restore({ snapshot: { taken_at: '', state_backup: assessment.restores_from, config_backup: null, from_version: version ?? 'unknown' }, state_path: statePath, config_path: null });
    process.stdout.write(`restored ${assessment.restores_from}\n`);
    return EXIT_CODES.ok;
  }

  if (command === 'open') {
    // This process serves the console and owns the run loop, so it takes the directory lock.
    const { db, service, project_id, state_dir } = openProject(root, { exclusive: true });
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
    // The console bundler needs esbuild, which a packaged install may not carry. Loading it
    // here rather than at module load keeps every other command working without it, and turns
    // its absence into a reported capability gap instead of a CLI that will not start.
    let consoleDir: string;
    try {
      const { buildConsole } = await import('./console-bundle.js');
      consoleDir = await buildConsole(path.join(state_dir, 'console'), {
        run_id: run.run_id, status: run.state, bootstrap_secret: bootstrap,
      });
    } catch (error) {
      process.stderr.write('the console cannot be built on this install: ' +
        `${String((error as Error).message).slice(0, 120)}\n` +
        'Everything else still works; `cm status` and `cm handoff` do not need it.\n');
      db.close();
      return EXIT_CODES.missing_capability;
    }
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
      process.stdout.write(json ? `${JSON.stringify(plan, null, 2)}\n`
        : `${renderPlan(plan, distribution.distribution_digest)}` +
          `\nActivation: 8 skill(s) into ${path.join(installRoot, 'skills')}, and the Client Mode section ` +
          `${flags['lead'] === true ? 'placed FIRST in' : 'appended to'} ${instructionsFile(host, installRoot)}.\n` +
          'Existing content is kept either way; uninstall removes only the marked section.\n');
      return EXIT_CODES.ok;
    }
    // The portable toolkit is what makes `cm` work anywhere: a bundled entry point plus the
    // files the controller reads, in a directory that does not depend on where the source is.
    // A launcher that pointed at a checkout would stop working the moment a folder moved.
    let portable: { root: string; launcher: string | null; bytes: number } | null = null;
    if (flags['no-portable'] !== true) {
      try {
        const { buildPortableToolkit } = await import('../../../packages/packaging/src/portable.js');
        const binDir = typeof flags['bin-dir'] === 'string' ? flags['bin-dir'] : path.join(os.homedir(), '.local', 'bin');
        portable = await buildPortableToolkit({
          out_root: path.join(home, 'toolkit'),
          launcher_path: path.join(binDir, 'cm'),
        });
      } catch (error) {
        process.stderr.write('the portable toolkit could not be built ' +
          `(${String((error as Error).message).slice(0, 120)}).\n` +
          'The skills and instructions below are still installed; `cm` will keep running from this checkout.\n');
      }
    }
    const record = applyInstall({ plan: approve(plan), distribution, now: new Date().toISOString() });
    // Copying the package under the host's config directory puts the files on disk; it does not
    // make the host read them. Activation writes the locations each host actually loads.
    const activated = activate({
      host, install_root: installRoot, distribution_root: distribution.root,
      lead: flags['lead'] === true,
    });
    if (portable !== null) {
      record.created.push(portable.root);
      if (portable.launcher !== null) record.created.push(portable.launcher);
    }
    record.created.push(...activated.created);
    record.backups.push(...activated.backups);
    writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n');
    process.stdout.write(json ? `${JSON.stringify(record, null, 2)}\n`
      : `installed ${String(record.created.length)} file(s) under ${installRoot}\n` +
        `${String(record.backups.length)} existing file(s) backed up, ${String(record.merged.length)} settings file(s) merged\n` +
        `${activated.summary}\n` +
        `${portable === null ? 'portable toolkit: not built; cm runs from this checkout\n'
          : `portable toolkit: ${portable.root} (${String(Math.round(portable.bytes / 1024))} KB)\n` +
            `${portable.launcher === null ? '' : `launcher: ${portable.launcher}\n`}`}` +
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
