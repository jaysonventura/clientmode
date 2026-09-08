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

export type HealthFinding = {
  code: 'TOOLKIT_MISSING' | 'TOOLKIT_STALE' | 'LAUNCHER_MISSING' | 'LAUNCHER_ORPHANED'
    | 'LAUNCHER_NOT_EXECUTABLE' | 'SKILLS_DRIFTED' | 'SKILLS_MISSING' | 'INSTRUCTIONS_MISSING'
    | 'STORE_WORLD_READABLE';
  detail: string;
  /** What the operator should run. Never empty. */
  remedy: string;
};

export type InstallHealth = {
  toolkit_root: string | null;
  launcher: string | null;
  hosts: Array<{ host: string; instructions: string; skills_dir: string; skills: number }>;
  findings: HealthFinding[];
  healthy: boolean;
};

const digestOf = (file: string): string =>
  `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;

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
  hosts: Array<{ host: string; install_root: string }>;
  launcher_path: string;
}): InstallHealth {
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
    const shipped = skillDigests(path.join(toolkitRoot, 'skills'), '');
    const source = skillDigests(path.join(input.source_root, 'skills'), '');
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
    const text = readFileSync(input.launcher_path, 'utf8');
    const named = /CM_TOOLKIT_ROOT:-([^}"]+)/.exec(text)?.[1];
    if (named !== undefined && !existsSync(path.join(named, 'cm.js'))) {
      findings.push({
        code: 'LAUNCHER_ORPHANED',
        detail: `the launcher points at ${named}, which has no toolkit in it`,
        remedy: 'cm install --host claude   (rebuilds the toolkit the launcher names)',
      });
    }
    // eslint-disable-next-line no-bitwise
    if ((statSync(input.launcher_path).mode & 0o111) === 0) {
      findings.push({
        code: 'LAUNCHER_NOT_EXECUTABLE', detail: `${input.launcher_path} is not executable`,
        remedy: `chmod +x ${input.launcher_path}`,
      });
    }
  }

  // Installs made before the stores were tightened keep the modes they were created with, and
  // so does anything restored from a backup or copied off another machine. The project stores
  // hold every client request, the approval record, and the verifier's signing material.
  const exposed = auditPermissions([path.join(input.home, 'projects')]);
  if (exposed.length > 0) {
    const shown = exposed.slice(0, 3).map(f => `${f.path} is ${f.mode}, expected ${f.expected}`);
    findings.push({
      code: 'STORE_WORLD_READABLE',
      detail: `${String(exposed.length)} path(s) under ${input.home} can be read by other accounts on this machine: ${shown.join('; ')}${exposed.length > 3 ? ', …' : ''}`,
      remedy: `chmod -R go-rwx ${path.join(input.home, 'projects')}`,
    });
  }

  const hosts = input.hosts.map(entry => {
    const skills_dir = path.join(entry.install_root, 'skills');
    const installed = skillDigests(skills_dir, 'cm-');
    const shipped = toolkitPresent ? skillDigests(path.join(toolkitRoot, 'skills'), '') : new Map<string, string>();
    const instructions = path.join(entry.install_root, entry.host === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
    if (installed.size === 0) {
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
    if (!existsSync(instructions) || !readFileSync(instructions, 'utf8').includes('<!-- client-mode:start -->')) {
      findings.push({
        code: 'INSTRUCTIONS_MISSING',
        detail: `${entry.host} will not load Client Mode: no section in ${instructions}`,
        remedy: `cm install --host ${entry.host} --lead`,
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
