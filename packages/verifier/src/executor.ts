/** Untrusted execution. Candidate build scripts and tests are hostile code by assumption.
 *
 * What this enforces, and how it is proved rather than asserted:
 *   - argv comes from the approved definition; there is no caller-argv parameter.
 *   - no shell: spawn(argv[0], argv.slice(1), { shell: false }).
 *   - the child environment is built from an allowlist, so no controller secret is inherited.
 *   - the child runs in its own process group, and the deadline kills the whole group;
 *     a survivor is quarantined rather than reported as terminated.
 *   - output is capped and truncation is recorded, so a flood cannot exhaust the host.
 *   - on macOS the child runs under a generated Seatbelt profile that denies network and
 *     the declared secret paths. `isolation` reports exactly what was in force.
 *
 * What it does not give you: a separate OS principal, a container or a VM. On a host with no
 * supported sandbox the isolation is reported UNAVAILABLE and the caller must treat the
 * result accordingly; it is never silently downgraded to "ran fine".
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EnvironmentProfile, NetworkProfileId } from './policy.js';

export type IsolationKind = 'macos_seatbelt' | 'none';

export type Isolation = {
  kind: IsolationKind;
  network: 'denied' | 'allowed';
  denied_read_paths: string[];
  allowed_write_paths: string[];
  /** Honest statement of what this mechanism does not provide. */
  limitations: string[];
};

export type ExecutionObservation = {
  executed: boolean;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  output_truncated: boolean;
  output_bytes: number;
  stdout: string;
  stderr: string;
  log_digest: string;
  started_at: string;
  finished_at: string;
  process_tree_terminated: boolean;
  quarantined: boolean;
  isolation: Isolation;
  observer_id: string;
};

export type EnvironmentReadiness =
  | { ready: true }
  | { ready: false; reason: 'PLATFORM_UNAVAILABLE' | 'TOOLCHAIN_UNAVAILABLE'; missing: string[] };

/** Only these variables reach a candidate process. Nothing is copied from the coordinator. */
function childEnvironment(input: { home: string; tmp: string; path: string }): NodeJS.ProcessEnv {
  return { PATH: input.path, HOME: input.home, TMPDIR: input.tmp, LANG: 'C.UTF-8', CI: '1' };
}

function which(executable: string, searchPath: string): string | null {
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory === '') continue;
    const candidate = path.join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** A check whose environment is unavailable stays unverified. The caller must not run a
 * different check in its place, and this function never suggests one. */
export function environmentReadiness(profile: EnvironmentProfile, searchPath: string): EnvironmentReadiness {
  if (profile.required_platform !== null && profile.required_platform !== os.platform()) {
    return { ready: false, reason: 'PLATFORM_UNAVAILABLE', missing: [`${profile.required_platform} (host is ${os.platform()})`] };
  }
  const search = [searchPath, ...profile.toolchain_paths].join(path.delimiter);
  const missing = profile.required_executables.filter(executable => which(executable, search) === null);
  return missing.length === 0 ? { ready: true } : { ready: false, reason: 'TOOLCHAIN_UNAVAILABLE', missing };
}

/** Seatbelt matches the kernel's canonical path. On macOS /var, /tmp and /etc are symlinks
 * into /private, so a profile written with the uncanonicalised path silently matches nothing
 * and a deny rule becomes a no-op. Every path in the profile is resolved first. */
function canonical(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function seatbeltProfile(input: {
  network: NetworkProfileId; denied_read_paths: string[]; allowed_write_paths: string[];
  allow_home_read: boolean; toolchain_paths: string[];
}): string {
  const denied = input.denied_read_paths.map(canonical);
  const writes = input.allowed_write_paths.map(canonical);
  const toolchains = input.toolchain_paths.map(canonical);
  const deniedReads = [...denied];
  if (!input.allow_home_read) deniedReads.push(canonical(os.homedir()));
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec* process-fork)',
    '(allow signal (target self))',
    '(allow sysctl-read mach-lookup)',
    '(allow file-read-metadata file-map-executable)',
    // Broad read is required for the dynamic linker and any real toolchain; the paths that
    // matter are denied explicitly below and the denials win.
    '(allow file-read*)',
    ...writes.map(target => `(allow file-write* (subpath ${JSON.stringify(target)}))`),
    '(allow file-write-data (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))',
    ...deniedReads.map(target => `(deny file-read* (subpath ${JSON.stringify(target)}))`),
    ...deniedReads.map(target => `(deny file-write* (subpath ${JSON.stringify(target)}))`),
    // Seatbelt takes the last matching rule, so declared toolchain paths are re-allowed
    // after the home denial. Secret paths are denied after this and therefore still win.
    ...toolchains.map(target => `(allow file-read* (subpath ${JSON.stringify(target)}))`),
    ...denied.map(target => `(deny file-read* (subpath ${JSON.stringify(target)}))`),
  ];
  lines.push(input.network === 'deny' ? '(deny network*)' : '(allow network*)');
  return lines.join('\n') + '\n';
}

async function stillAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type ExecuteInput = {
  argv: string[];
  cwd: string;
  sandbox_root: string;
  timeout_seconds: number;
  maximum_output_bytes: number;
  network_profile_id: NetworkProfileId;
  environment: EnvironmentProfile;
  observer_id: string;
  now: () => string;
  /** Restricted search path for the child. Defaults to system directories only. */
  search_path?: string;
};

export async function execute(input: ExecuteInput): Promise<ExecutionObservation> {
  const started_at = input.now();
  const searchPath = [
    input.search_path ?? '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin',
    ...input.environment.toolchain_paths,
  ].join(path.delimiter);
  const sandboxHome = path.join(input.sandbox_root, 'home');
  const sandboxTmp = path.join(input.sandbox_root, 'tmp');
  mkdirSync(sandboxHome, { recursive: true });
  mkdirSync(sandboxTmp, { recursive: true });

  const writable = [...new Set([...input.environment.allowed_write_paths, input.sandbox_root, input.cwd])];
  let argv = input.argv;
  let isolation: Isolation;
  if (os.platform() === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    const profilePath = path.join(input.sandbox_root, 'sandbox.sb');
    writeFileSync(profilePath, seatbeltProfile({
      network: input.network_profile_id,
      denied_read_paths: input.environment.denied_read_paths,
      allowed_write_paths: writable,
      allow_home_read: input.environment.allow_home_read,
      toolchain_paths: input.environment.toolchain_paths,
    }));
    argv = ['/usr/bin/sandbox-exec', '-f', profilePath, ...input.argv];
    isolation = {
      kind: 'macos_seatbelt',
      network: input.network_profile_id === 'deny' ? 'denied' : 'allowed',
      denied_read_paths: input.environment.denied_read_paths,
      allowed_write_paths: writable,
      limitations: [
        'Same OS user as the coordinator: this is a kernel sandbox, not a separate principal.',
        'No container or VM boundary; kernel or sandbox escapes are not mitigated here.',
        'Reads outside the denied paths are permitted so the dynamic linker and toolchains work.',
      ],
    };
  } else {
    isolation = {
      kind: 'none', network: 'allowed',
      denied_read_paths: [], allowed_write_paths: writable,
      limitations: [`No supported sandbox on ${os.platform()}; execution isolation is UNAVAILABLE on this host.`],
    };
  }

  const executable = argv[0];
  if (executable === undefined) throw new Error('EMPTY_ARGV');

  return await new Promise<ExecutionObservation>(resolve => {
    const child = spawn(executable, argv.slice(1), {
      cwd: input.cwd,
      env: childEnvironment({ home: sandboxHome, tmp: sandboxTmp, path: searchPath }),
      shell: false,
      detached: true, // own process group, so the deadline can reach the whole tree
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const group = child.pid === undefined ? null : -child.pid;

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const collect = (chunk: Buffer, into: 'out' | 'err'): void => {
      bytes += chunk.byteLength;
      if (bytes > input.maximum_output_bytes) {
        truncated = true;
        stop('OUTPUT_LIMIT');
        return;
      }
      if (into === 'out') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', chunk => collect(chunk as Buffer, 'out'));
    child.stderr.on('data', chunk => collect(chunk as Buffer, 'err'));

    function stop(reason: 'DEADLINE' | 'OUTPUT_LIMIT'): void {
      if (reason === 'DEADLINE') timedOut = true;
      try {
        if (group !== null) process.kill(group, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* already gone */ }
    }

    const deadline = setTimeout(() => stop('DEADLINE'), input.timeout_seconds * 1000);

    const finish = async (exit_code: number | null, signal: string | null): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      // Give the group a moment, then confirm rather than assume the tree is gone.
      await new Promise(done => setTimeout(done, 150));
      let survivors = false;
      if (group !== null) {
        try {
          process.kill(group, 0);
          survivors = true;
          process.kill(group, 'SIGKILL');
          await new Promise(done => setTimeout(done, 150));
          survivors = await stillAlive(-group);
        } catch { survivors = false; }
      }
      const finished_at = input.now();
      resolve({
        executed: true, exit_code, signal, timed_out: timedOut,
        output_truncated: truncated, output_bytes: bytes,
        stdout: stdout.slice(0, input.maximum_output_bytes),
        stderr: stderr.slice(0, input.maximum_output_bytes),
        log_digest: `sha256:${createHash('sha256').update(stdout + stderr, 'utf8').digest('hex')}`,
        started_at, finished_at,
        process_tree_terminated: !survivors,
        quarantined: survivors,
        isolation, observer_id: input.observer_id,
      });
    };

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({
        executed: false, exit_code: null, signal: null, timed_out: false,
        output_truncated: false, output_bytes: 0, stdout: '', stderr: String((error as Error).message),
        log_digest: `sha256:${createHash('sha256').update(String((error as Error).message), 'utf8').digest('hex')}`,
        started_at, finished_at: input.now(), process_tree_terminated: true, quarantined: false,
        isolation, observer_id: input.observer_id,
      });
    });
    child.on('close', (code, signal) => { void finish(code, signal); });
  });
}
