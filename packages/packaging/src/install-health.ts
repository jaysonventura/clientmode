/** Is the install on this machine actually usable?
 *
 * Three things go wrong quietly after a successful install. The toolkit that was bundled falls
 * behind the source it was built from. The launcher points at a directory somebody deleted. The
 * skills copied into the host's directory drift from the ones the toolkit ships. None of these
 * announce themselves; each one shows up later as behaviour the client cannot explain.
 *
 * Every finding here names a file and says what to run. A health check that reports a problem
 * without saying what to do about it has moved the work rather than done it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { auditPermissions } from '../../verifier/src/file-permissions.js';
import { BLOCK_START, SKILLS_DIRECTORY } from './hosts.js';
import { isExecutableLauncher, launcherToolkitRoot } from './platform.js';

export type HealthFinding = {
  code: 'TOOLKIT_MISSING' | 'TOOLKIT_STALE' | 'LAUNCHER_MISSING' | 'LAUNCHER_ORPHANED'
    | 'LAUNCHER_NOT_EXECUTABLE' | 'SKILLS_DRIFTED' | 'SKILLS_MISSING' | 'INSTRUCTIONS_MISSING'
    | 'STORE_WORLD_READABLE' | 'CLAUDE_PLUGIN_PENDING';
  detail: string;
  /** What the operator should run. Never empty. */
  remedy: string;
};

export type InstallHealth = {
  toolkit_root: string | null;
  launcher: string | null;
  hosts: Array<{ host: string; instructions: string; skills_dir: string | null; skills: number }>;
  findings: HealthFinding[];
  healthy: boolean;
};

/** A skill copied into a host is renamed to match its folder (`name: cm-tdd`), so the name line is
 * left out of the comparison; everything else in the file has to match. */
const digestOf = (file: string): string =>
  `sha256:${createHash('sha256').update(readFileSync(file, 'utf8').replace(/^(---\r?\nname:\s*)\S+/, '$1')).digest('hex')}`;

const INSTRUCTIONS: Record<string, string> = {
  claude: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md', cursor: path.join('rules', 'client-mode.mdc'),
};

function skillDigests(directory: string, prefix: string): Map<string, string> {
  const found = new Map<string, string>();
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith(prefix)) continue;
    const file = path.join(directory, entry, 'SKILL.md');
    if (existsSync(file)) found.set(entry.slice(prefix.length), digestOf(file));
  }
  return found;
}

export function checkInstall(input: {
  home: string;
  source_root: string;
  /** `skills_dir: null` means the host takes its skills from the `cm` plugin; the default is the
   * host directory's own `skills`. `instructions` defaults to the file that host loads. */
  hosts: Array<{ host: string; install_root: string; skills_dir?: string | null; instructions?: string; plugin_pending?: boolean }>;
  launcher_path: string;
  platform?: NodeJS.Platform;
}): InstallHealth {
  const platform = input.platform ?? process.platform;
  const findings: HealthFinding[] = [];
  const toolkitRoot = path.join(input.home, 'toolkit');
  const toolkitPresent = existsSync(path.join(toolkitRoot, 'cm.js'));
  if (!toolkitPresent) {
    findings.push({
      code: 'TOOLKIT_MISSING', detail: `no bundled toolkit at ${toolkitRoot}`,
      remedy: 'cm install --host claude   (or --host codex)',
    });
  }

  // Stale means the shipped skills no longer match the source they were built from. Comparing
  // the bundle itself would flag every rebuild; comparing what it carries is what the client
  // actually gets.
  if (toolkitPresent) {
    const shipped = skillDigests(path.join(toolkitRoot, SKILLS_DIRECTORY), '');
    const source = skillDigests(path.join(input.source_root, SKILLS_DIRECTORY), '');
    const drifted = [...source.entries()].filter(([name, digest]) => shipped.get(name) !== digest).map(([name]) => name);
    if (source.size > 0 && drifted.length > 0) {
      findings.push({
        code: 'TOOLKIT_STALE',
        detail: `the installed toolkit was built from a different source: ${drifted.join(', ')}`,
        remedy: 'cm install --host claude --lead   (rebuilds and reinstalls)',
      });
    }
  }

  const launcherPresent = existsSync(input.launcher_path);
  if (!launcherPresent) {
    findings.push({
      code: 'LAUNCHER_MISSING', detail: `no launcher at ${input.launcher_path}`,
      remedy: `cm install --host claude --bin-dir ${path.dirname(input.launcher_path)}`,
    });
  } else {
    const named = launcherToolkitRoot(readFileSync(input.launcher_path, 'utf8'));
    if (named !== null && !existsSync(path.join(named, 'cm.js'))) {
      findings.push({
        code: 'LAUNCHER_ORPHANED',
        detail: `the launcher points at ${named}, which has no toolkit in it`,
        remedy: 'cm install --host claude   (rebuilds the toolkit the launcher names)',
      });
    }
    if (!isExecutableLauncher(input.launcher_path, platform)) {
      findings.push({
        code: 'LAUNCHER_NOT_EXECUTABLE', detail: `${input.launcher_path} is not executable`,
        remedy: `chmod +x ${input.launcher_path}`,
      });
    }
  }

  // Installs made before the stores were tightened keep the modes they were created with, and
  // so does anything restored from a backup or copied off another machine. The project stores
  // hold every client request, the approval record, and the verifier's signing material.
  // Windows has no POSIX modes to read — every file reports 0666 — and its ACLs are not inspected
  // here, so the check is not run there rather than reported as a failure it cannot measure.
  const exposed = platform === 'win32' ? [] : auditPermissions([path.join(input.home, 'projects')]);
  if (exposed.length > 0) {
    const shown = exposed.slice(0, 3).map(f => `${f.path} is ${f.mode}, expected ${f.expected}`);
    findings.push({
      code: 'STORE_WORLD_READABLE',
      detail: `${String(exposed.length)} path(s) under ${input.home} can be read by other accounts on this machine: ${shown.join('; ')}${exposed.length > 3 ? ', …' : ''}`,
      remedy: `chmod -R go-rwx ${path.join(input.home, 'projects')}`,
    });
  }

  const hosts = input.hosts.map(entry => {
    const skills_dir = entry.skills_dir === undefined ? path.join(entry.install_root, 'skills') : entry.skills_dir;
    const shipped = toolkitPresent ? skillDigests(path.join(toolkitRoot, SKILLS_DIRECTORY), '') : new Map<string, string>();
    // Skills that come from the plugin are the toolkit's own copy; there is nothing to drift.
    const installed = skills_dir === null ? shipped : skillDigests(skills_dir, 'cm-');
    const instructions = entry.instructions ?? path.join(entry.install_root, INSTRUCTIONS[entry.host] ?? 'AGENTS.md');
    if (skills_dir === null && !toolkitPresent) {
      // Reported once, as TOOLKIT_MISSING: the plugin marketplace is the toolkit.
    } else if (installed.size === 0) {
      findings.push({
        code: 'SKILLS_MISSING', detail: `${entry.host} has no Client Mode skills in ${skills_dir}`,
        remedy: `cm install --host ${entry.host} --lead`,
      });
    } else if (shipped.size > 0) {
      const drifted = [...shipped.entries()].filter(([name, digest]) => installed.get(name) !== digest).map(([name]) => name);
      if (drifted.length > 0) {
        findings.push({
          code: 'SKILLS_DRIFTED',
          detail: `${entry.host} is using different skills from the installed toolkit: ${drifted.join(', ')}`,
          remedy: `cm install --host ${entry.host} --lead`,
        });
      }
    }
    const owned = instructions.endsWith('.mdc');
    if (!existsSync(instructions) || (!owned && !readFileSync(instructions, 'utf8').includes(BLOCK_START))) {
      findings.push({
        code: 'INSTRUCTIONS_MISSING',
        detail: `${entry.host} will not load Client Mode: no section in ${instructions}`,
        remedy: `cm install --host ${entry.host} --lead`,
      });
    }
    if (entry.plugin_pending === true) {
      findings.push({
        code: 'CLAUDE_PLUGIN_PENDING',
        detail: 'the cm plugin is declared in Claude Code settings but was never installed: claude was not on PATH when Client Mode was installed',
        remedy: 'cm install --host claude',
      });
    }
    return { host: entry.host, instructions, skills_dir, skills: installed.size };
  });

  return {
    toolkit_root: toolkitPresent ? toolkitRoot : null,
    launcher: launcherPresent ? input.launcher_path : null,
    hosts, findings, healthy: findings.length === 0,
  };
}
