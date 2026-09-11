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
import { chmodSync, cpSync, mkdirSync, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
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
import { HOSTS, activateHost, deactivateHost, type HostLayout, type HostName } from '../../../packages/packaging/src/hosts.js';
import { findExecutable, spawnPlan } from '../../../packages/packaging/src/platform.js';
import { completePendingClaudePlugin, parseHostList, readRecord, setupHosts, uninstallHosts, type SetupRecord } from './setup.js';
import { cancelRun, createRun } from './run.js';
import { rejectsCallerCommand } from './verify.js';
import { assessRollback, restore, upgrade } from '../../../packages/packaging/src/upgrade.js';
import { checkInstall } from '../../../packages/packaging/src/install-health.js';
import { redactValue } from '../../../packages/observability/src/redaction.js';
import { toolkitRoot } from '../../../packages/contracts/src/toolkit-root.js';
import { writeConsoleIndex } from './console-page.js';
import { makePrivateDirectory, PRIVATE_FILE_MODE } from '../../../packages/verifier/src/file-permissions.js';

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
/** The launcher this machine's install actually wrote, from the record it left behind.
 * `--bin-dir` puts it somewhere other than the default, and checking the default instead means
 * reporting on a file that belongs to a different install — or to a different person. */
export function installedLauncher(home: string): string | null {
  for (const host of HOSTS) {
    const recordFile = path.join(home, `install-${host}.json`);
    if (!existsSync(recordFile)) continue;
    try {
      const record = JSON.parse(readFileSync(recordFile, 'utf8')) as { launcher?: string | null };
      if (typeof record.launcher === 'string') return record.launcher;
    } catch { /* an unreadable record is not a launcher */ }
  }
  return null;
}

export function cmHome(): string {
  return process.env['CM_HOME'] ?? path.join(os.homedir(), '.client-mode');
}

export function stateDirFor(root: string): string {
  return path.join(cmHome(), 'projects', createHash('sha256').update(canonicalRoot(root)).digest('hex').slice(0, 16));
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
  // Owner-only from $CM_HOME down. Everything the controller writes for a project lands here,
  // and the two directories above it are tightened by name because an install made before this
  // existed already has them at the process umask — one client project per readable entry.
  makePrivateDirectory(cmHome());
  makePrivateDirectory(path.join(cmHome(), 'projects'));
  makePrivateDirectory(state_dir);
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

export type Preference = { preferred_host: HostName };

function configFile(): string {
  return path.join(cmHome(), 'config.json');
}

export function readPreference(): Preference | null {
  const file = configFile();
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Preference>;
    return (HOSTS as readonly string[]).includes(String(parsed.preferred_host))
      ? { preferred_host: parsed.preferred_host as HostName } : null;
  } catch { return null; }
}

export function writePreference(host: HostName): string {
  const file = configFile();
  makePrivateDirectory(path.dirname(file));
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
  writeFileSync(file, JSON.stringify({ ...current, preferred_host: host }, null, 2) + '\n');
  return file;
}

/** The command each host is started with. Cursor's CLI installs as `agent`. */
export const HOST_EXECUTABLES: Record<HostName, string> = { claude: 'claude', codex: 'codex', gemini: 'gemini', cursor: 'agent' };

function onPath(host: HostName): boolean {
  return findExecutable(HOST_EXECUTABLES[host], process.env) !== null;
}

/** Which host a bare `cm` should start: the stated preference if it is installed, otherwise the
 * only one that is. Two installed hosts and no preference is a question, not a guess. */
export function chooseHost(input: { requested?: string; preference: Preference | null; installed: string[] }):
  | { host: HostName; why: string }
  | { host: null; reason: string } {
  if (input.requested !== undefined) {
    if (!(HOSTS as readonly string[]).includes(input.requested)) return { host: null, reason: `unknown host: ${input.requested}` };
    if (!input.installed.includes(input.requested)) return { host: null, reason: `${input.requested} is not installed on this machine` };
    return { host: input.requested as HostName, why: 'asked for on the command line' };
  }
  const preferred = input.preference?.preferred_host;
  if (preferred !== undefined && input.installed.includes(preferred)) return { host: preferred, why: 'your saved preference' };
  if (preferred !== undefined) return { host: null, reason: `your preferred host (${preferred}) is not installed on this machine` };
  if (input.installed.length === 1) return { host: input.installed[0] as HostName, why: 'the only host installed' };
  if (input.installed.length === 0) return { host: null, reason: 'none of claude, codex, gemini or cursor (agent) is installed' };
  return { host: null, reason: `${input.installed.join(', ')} are installed and no preference is saved` };
}

const CAPABILITY_HOSTS: HostSpec[] = [
  { provider: 'claude', surface: 'native_cli', executable: 'claude' },
  { provider: 'codex', surface: 'native_cli', executable: 'codex' },
];

const REPO_ROOT = toolkitRoot();
export const CM_VERSION = '2.0.0';

/** Pause stops new work being dispatched. It does not reach into a provider's own queue, and
 * saying otherwise would be the one thing this command must never claim. */
const PAUSE_NOTE = 'New work is not dispatched. Work already in flight with a provider is not ' +
  'reached by this command; nothing here claims it stopped.';

/** The host directory itself, with skills copied into its own `skills` folder: the layout the
 * packaging gates exercise, and the one a 1.x install used. `cm install` uses `hostLayout`. */
function directLayout(host: 'claude' | 'codex', install_root: string): HostLayout {
  return {
    host, config_root: install_root, instructions: path.join(install_root, host === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'),
    instructions_kind: 'block', skills_root: path.join(install_root, 'skills'), skill_reference: 'cm-',
  };
}

/** Put the package where the host will actually read it: skills into the host's skills directory,
 * rules into the instructions file it loads, inside markers. */
export function activate(input: {
  host: 'claude' | 'codex'; install_root: string; distribution_root: string;
  /** Lead mode puts Client Mode first and treats whatever was already there as reference. */
  lead?: boolean;
}): { created: string[]; backups: Array<{ target: string; backup: string }>; summary: string } {
  return activateHost({
    layout: directLayout(input.host, input.install_root), source_root: REPO_ROOT, lead: input.lead === true,
    skills_source: path.join(input.distribution_root, 'skills'),
  });
}

/** Take the activation back out: the marked section and the `cm-` skills, nothing else. */
export function deactivate(input: { host: 'claude' | 'codex'; install_root: string }): { removed: string[]; summary: string } {
  const { removed } = deactivateHost({ layout: directLayout(input.host, input.install_root), remove_skills: true });
  return { removed, summary: `deactivated: ${String(removed.length)} path(s) removed; everything outside the Client Mode section left as it was` };
}

function usage(): string {
  const width = Math.max(...COMMANDS.map(command => command.name.length));
  return [
    'cm — Client Mode',
    '',
    'Usage: cm                                    start your preferred host here, with Client Mode loaded',
    '       cm use <claude|codex|gemini|cursor>   choose which host a bare `cm` starts',
    '       cm <command> [options]',
    '',
    ...COMMANDS.map(command => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Common options:',
    '  --root <path>     the project directory to work in (default: the current directory)',
    '  --json            machine-readable output',
    '  --host <list>     (install/uninstall) claude, codex, gemini, cursor, a comma list, or all (default)',
    '  --no-lead         (install) append Client Mode after existing instructions instead of leading',
    '  --no-autonomy     (install) leave each host\'s approval/permission settings unchanged',
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
    const installed = HOSTS.filter(onPath);
    const chosen = chooseHost({
      ...(typeof flags['host'] === 'string' && !passthroughOnly ? { requested: flags['host'] } : {}),
      preference: readPreference(), installed,
    });
    if (chosen.host === null) {
      process.stderr.write(`${chosen.reason}.\n`);
      if (installed.length > 1) process.stderr.write(`Pick one: ${installed.map(host => `cm use ${host}`).join('   |   ')}\n`);
      return EXIT_CODES.missing_capability;
    }
    const resolved = canonicalRoot(root);
    const hostArgv = passthroughOnly ? [...argv] : positional.filter(token => token !== 'start');
    // Claude Code installed after Client Mode: finish the plugin install before the session starts,
    // so the first session already has it rather than a declaration it may not act on.
    if (chosen.host === 'claude') {
      const repaired = completePendingClaudePlugin({ cm_home: cmHome(), env: process.env, claude: findExecutable('claude', process.env) });
      if (repaired === 'installed') process.stderr.write('Installed the cm plugin into Claude Code (it was waiting for claude to be on PATH).\n');
      if (repaired === 'failed') process.stderr.write('The cm plugin could not be installed into Claude Code yet; run `cm install --host claude` to see why.\n');
    }

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
        } else if (hostArgv.length === 0 && chosen.host === 'codex') {
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
    const executable = findExecutable(HOST_EXECUTABLES[chosen.host], process.env) ?? HOST_EXECUTABLES[chosen.host];
    const plan = spawnPlan(executable, hostArgv);
    const result = spawnSync(plan.command, plan.args, { stdio: 'inherit', cwd: resolved, windowsVerbatimArguments: plan.verbatim });
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
      // The briefing quotes the client's own words back. It is the one file here that gets
      // copied out of the store and mailed around, so it carries its own mode rather than
      // relying on the directory it happens to be sitting in.
      const briefingFile = path.join(state_dir, 'HANDOFF.md');
      writeFileSync(briefingFile, text, { mode: PRIVATE_FILE_MODE });
      chmodSync(briefingFile, PRIVATE_FILE_MODE);
      process.stdout.write(json ? `${JSON.stringify(handoff, null, 2)}\n` : text);
      return EXIT_CODES.ok;
    } finally { db.close(); }
  }

  if (command === 'use') {
    const host = positional[0] ?? (typeof flags['host'] === 'string' ? flags['host'] : undefined);
    if (host === undefined || !(HOSTS as readonly string[]).includes(host)) {
      process.stderr.write('use needs a host: cm use claude | codex | gemini | cursor\n');
      return EXIT_CODES.input_or_contract_error;
    }
    const file = writePreference(host as HostName);
    process.stdout.write(`${host} is now the host a bare \`cm\` starts.\nsaved in ${file}\n`);
    return EXIT_CODES.ok;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return EXIT_CODES.ok;
  }
  if (command === 'version' || command === '--version') {
    process.stdout.write(`cm ${CM_VERSION} (node ${process.versions.node}, ${os.platform()}-${os.arch()})\n`);
    return EXIT_CODES.ok;
  }
  if (command === 'commands') {
    process.stdout.write(`${JSON.stringify(COMMANDS, null, json ? 2 : 0)}\n`);
    return EXIT_CODES.ok;
  }
  if (command === 'doctor') {
    // The install's own health comes first: a client whose launcher points at a deleted folder
    // does not need a capability report, they need to know that.
    // Report on the hosts this machine's install configured, where it configured them.
    const records = HOSTS.map(host => readRecord(cmHome(), host)).filter((record): record is SetupRecord => (record as SetupRecord | null)?.schema === 2);
    const health = checkInstall({
      home: cmHome(),
      source_root: REPO_ROOT,
      hosts: records.length > 0
        ? records.map(record => ({ host: record.host, install_root: record.layout.config_root, skills_dir: record.layout.skills_root, instructions: record.layout.instructions, plugin_pending: record.plugin?.method === 'settings' }))
        : [
          { host: 'claude', install_root: path.join(os.homedir(), '.claude'), skills_dir: null },
          { host: 'codex', install_root: path.join(os.homedir(), '.codex'), skills_dir: path.join(os.homedir(), '.agents', 'skills') },
        ],
      launcher_path: installedLauncher(cmHome()) ?? path.join(os.homedir(), '.local', 'bin', 'cm'),
    });
    const { report } = await doctor({
      hosts: CAPABILITY_HOSTS, billing_mode: 'native_account', now: new Date().toISOString(),
      required_capabilities: [],
    });
    if (json) process.stdout.write(`${JSON.stringify({ install: health, ...report }, null, 2)}\n`);
    else {
      process.stdout.write(`Client Mode doctor — ${report.generated_at}\n`);
      process.stdout.write(`  install   toolkit ${health.toolkit_root ?? 'not installed'}\n`);
      process.stdout.write(`            launcher ${health.launcher ?? 'not installed'}\n`);
      for (const host of health.hosts) {
        process.stdout.write(`            ${host.host}: ${String(host.skills)} skill(s)\n`);
      }
      for (const finding of health.findings) {
        process.stdout.write(`  ! ${finding.code}: ${finding.detail}\n      fix: ${finding.remedy}\n`);
      }
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
    // A broken install is a missing capability, not a passing report.
    return (health.healthy ? report.exit_code : EXIT_CODES.missing_capability) as ExitCode;
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
    const boot = { run_id: run.run_id, status: run.state, bootstrap_secret: bootstrap };
    let consoleDir: string;
    try {
      // An install ships the console already compiled. A checkout does not, so it is built on
      // the spot — the same bundler, run at a different time.
      const shipped = path.join(toolkitRoot(), 'console', 'app.js');
      if (existsSync(shipped)) {
        consoleDir = path.join(state_dir, 'console');
        mkdirSync(consoleDir, { recursive: true });
        cpSync(path.dirname(shipped), consoleDir, { recursive: true });
        writeConsoleIndex(consoleDir, boot);
      } else {
        const { buildConsole } = await import('./console-bundle.js');
        consoleDir = await buildConsole(path.join(state_dir, 'console'), boot);
      }
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
    const hosts = parseHostList(flags['host']);
    if (hosts === null) {
      process.stderr.write(`${command} --host takes claude, codex, gemini, cursor, a comma-separated list, or all\n`);
      return EXIT_CODES.input_or_contract_error;
    }
    const home = cmHome();

    if (command === 'uninstall') {
      const installedHosts = hosts.filter(host => readRecord(home, host) !== null);
      if (installedHosts.length === 0) {
        process.stderr.write(`nothing installed for ${hosts.join(', ')} by this toolkit\n`);
        return EXIT_CODES.input_or_contract_error;
      }
      const outcome = uninstallHosts({ hosts: installedHosts, cm_home: home, env: process.env });
      process.stdout.write(json ? `${JSON.stringify(outcome, null, 2)}\n`
        : `removed Client Mode from ${outcome.removed.join(', ')}; replaced values restored\n${outcome.notes.map(note => `  note: ${note}\n`).join('')}`);
      return EXIT_CODES.ok;
    }

    if (typeof flags['install-root'] === 'string' && hosts.length !== 1) {
      process.stderr.write('--install-root relocates one host; name it with --host\n');
      return EXIT_CODES.input_or_contract_error;
    }
    const outcome = await setupHosts({
      hosts, home: os.homedir(), cm_home: home, env: process.env, source_root: REPO_ROOT,
      bin_dir: typeof flags['bin-dir'] === 'string' ? path.resolve(flags['bin-dir']) : path.join(os.homedir(), '.local', 'bin'),
      lead: flags['no-lead'] !== true, autonomy: flags['no-autonomy'] !== true, portable: flags['no-portable'] !== true,
      install_root: typeof flags['install-root'] === 'string' ? path.resolve(flags['install-root']) : null,
      dry_run: flags['dry-run'] === true, version: CM_VERSION, now: new Date().toISOString(),
    });
    if (json) process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
    else {
      process.stdout.write(`${outcome.lines.join('\n')}\n`);
      for (const note of outcome.notes) process.stdout.write(`  note: ${note}\n`);
      if (flags['dry-run'] !== true) process.stdout.write('\nRestart any open Claude Code, Codex, Gemini or Cursor session to load it. Check it with: cm doctor\nRemove it with: cm uninstall\n');
    }
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
