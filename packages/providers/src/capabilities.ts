/** Capability detection.
 *
 * Two rules do most of the work here:
 *   1. A capability reaches `observed_working` only when a disposable probe actually ran and
 *      succeeded on this host. Configuration, documentation and installation get you as far
 *      as `configured` and no further.
 *   2. The toolkit's own runtime proves nothing about a target. Node being present says
 *      nothing about whether an iOS build, an Android device or a model environment is
 *      available, and detection never lets one stand in for the other.
 *
 * Missing credentials produce BLOCKED_ACCESS. They never fall back to metered API billing and
 * never silently switch provider.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Capability, CapabilityReport } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';
import { spawnPlan } from '../../packaging/src/platform.js';
import type { Admission, AdmissionRequest, CapabilityProbe, CapabilityState, DetectedHost, HostSurface, ProbeOutcome } from './interface.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/** Hosts print versions differently: `2.1.263 (Claude Code)` and `codex-cli 0.153.4` are both
 * ordinary. The first semver-looking token on the first line is taken, and only the first
 * line, so a long help dump cannot supply a version the host never claimed. */
const VERSION_PATTERN = /(\d+\.\d+\.\d+)/;
const PROBE_TIMEOUT_MS = 15_000;
/** Probe stdout is parsed by callers, so it is kept whole up to a real limit rather than
 * trimmed to a log-friendly size; a truncated JSON document is an unparseable one. */
const PROBE_MAXIMUM_STDOUT = 262_144;

/** Only a trusted local path is ever executed. A path from a web page, a document or a client
 * message is data; it does not become an executable here. */
export function isTrustedExecutablePath(candidate: string, trustedRoots: string[]): boolean {
  if (!path.isAbsolute(candidate)) return false;
  const resolved = path.resolve(candidate);
  return trustedRoots.some(root => resolved === root || resolved.startsWith(path.resolve(root) + path.sep));
}

/** Search the trusted roots and the process search path, and accept a hit only if it lands
 * inside a trusted root. A host may legitimately live in a configured directory that is not
 * on PATH; a binary on PATH but outside the trusted roots is still not executed. */
export function whichTrusted(executable: string, trustedRoots: string[], env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const windows = platform === 'win32';
  const directories = [...trustedRoots, ...(env['PATH'] ?? env['Path'] ?? '').split(windows ? ';' : ':')];
  // Windows runs `name` + a PATHEXT extension; an extensionless file there is not a program.
  const extensions = windows ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).flatMap(ext => [ext, ext.toLowerCase()]) : [''];
  for (const directory of directories) {
    if (directory === '') continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      if (existsSync(candidate) && isTrustedExecutablePath(candidate, trustedRoots)) return candidate;
    }
  }
  return null;
}

async function invoke(executable: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<ProbeOutcome> {
  try {
    // An npm `.cmd` shim cannot be executed directly on Windows; it runs through cmd.exe with its
    // arguments escaped, which is what spawnPlan builds.
    const plan = spawnPlan(executable, args);
    const { stdout, stderr } = await run(plan.command, plan.args, { timeout: PROBE_TIMEOUT_MS, env: { ...process.env, ...env }, windowsVerbatimArguments: plan.verbatim });
    return { ran: true, exit_code: 0, stdout: stdout.slice(0, PROBE_MAXIMUM_STDOUT), stderr: stderr.slice(0, 2000) };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      ran: true,
      exit_code: typeof failure.code === 'number' ? failure.code : null,
      stdout: (failure.stdout ?? '').slice(0, PROBE_MAXIMUM_STDOUT),
      stderr: (failure.stderr ?? String((error as Error).message)).slice(0, 2000),
    };
  }
}

export async function detectHost(input: {
  provider: DetectedHost['provider'];
  surface: HostSurface;
  executable: string;
  trusted_roots: string[];
  sdk_package?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<DetectedHost> {
  const executable_path = path.isAbsolute(input.executable)
    ? (isTrustedExecutablePath(input.executable, input.trusted_roots) ? input.executable : null)
    : whichTrusted(input.executable, input.trusted_roots);
  let sdk_version: string | null = null;
  if (input.sdk_package !== undefined) {
    try {
      sdk_version = (require(`${input.sdk_package}/package.json`) as { version: string }).version;
    } catch {
      sdk_version = null;
    }
  }
  if (executable_path === null) {
    return { provider: input.provider, surface: input.surface, installed: false, executable_path: null, version: null, version_recognised: false, sdk_version };
  }
  const outcome = await invoke(executable_path, ['--version'], input.env ?? {});
  const matched = VERSION_PATTERN.exec(outcome.stdout.trim().split('\n')[0] ?? '');
  return {
    provider: input.provider, surface: input.surface, installed: outcome.exit_code === 0,
    executable_path, version: matched?.[1] ?? null,
    // An answer the detector cannot parse is an unrecognised host, not a supported one.
    version_recognised: outcome.exit_code === 0 && matched !== null,
    sdk_version,
  };
}

export type DetectionResult = {
  report: CapabilityReport;
  states: Map<string, CapabilityState>;
  host: DetectedHost;
  probes: Record<string, ProbeOutcome | null>;
};

/** The environment fingerprint carries no secret values: paths, versions and modes only. */
export function environmentFingerprint(host: DetectedHost): string {
  return digest({
    os: os.platform(), arch: os.arch(), node: process.versions.node,
    provider: host.provider, surface: host.surface,
    host_version: host.version, sdk_version: host.sdk_version,
  });
}

export async function detectCapabilities(input: {
  host: DetectedHost;
  probes: CapabilityProbe[];
  billing_mode: 'native_account' | 'approved_api' | 'unknown';
  observed_at: string;
}): Promise<DetectionResult> {
  const capabilities: Capability[] = [];
  const states = new Map<string, CapabilityState>();
  const outcomes: Record<string, ProbeOutcome | null> = {};

  for (const probe of input.probes) {
    const configured = probe.configured();
    let state: CapabilityState = configured ? 'configured' : 'unavailable';
    let outcome: ProbeOutcome | null = null;
    const evidence_refs: string[] = [];

    // A host whose version we cannot recognise never gets a working verdict: we do not know
    // what its output means.
    if (configured && probe.probe !== undefined && input.host.version_recognised) {
      outcome = await probe.probe(input.host);
      outcomes[probe.name] = outcome;
      if (outcome.ran && outcome.exit_code === 0 && outcome.unrecognised_schema !== true) {
        state = 'observed_working';
        evidence_refs.push(`probe:${probe.name}:exit0`);
      } else {
        evidence_refs.push(`probe:${probe.name}:exit${String(outcome.exit_code)}`);
      }
    } else {
      outcomes[probe.name] = null;
      if (configured && probe.probe === undefined) evidence_refs.push(`declared:${probe.name}:no_probe_available`);
      if (configured && !input.host.version_recognised) evidence_refs.push(`blocked:${probe.name}:host_version_unrecognised`);
    }

    states.set(probe.name, state);
    capabilities.push({
      name: probe.name,
      documented: probe.documented,
      configured,
      observed_working: state === 'observed_working',
      evidence_refs,
      limitation: probe.limitation,
    });
  }

  const report: CapabilityReport = {
    kind: 'capability_report', schema_version: 1,
    report_id: `report_${digest({ host: input.host, states: [...states] }).slice(7, 39)}`,
    provider: input.host.provider === 'mock' ? 'mock' : input.host.provider,
    host_surface: input.host.surface,
    host_version: input.host.version ?? 'unrecognised',
    sdk_version: input.host.sdk_version,
    os: `${os.platform()}-${os.arch()}`,
    billing_mode: input.billing_mode,
    capabilities,
    observed_at: input.observed_at,
  };
  return { report, states, host: input.host, probes: outcomes };
}

/** Job admission. Every required capability must have been observed, the billing mode must
 * match what was authorized, and no account means blocked, not a quiet substitution. */
export function admitProviderJob(request: AdmissionRequest): Admission {
  if (!request.account_accessible) {
    return { admitted: false, reason: 'BLOCKED_ACCESS', detail: ['provider account is not accessible; no automatic API or provider fallback'] };
  }
  if (request.requested_billing_mode !== request.authorized_billing_mode) {
    return {
      admitted: false, reason: 'BILLING_MODE_NOT_AUTHORIZED',
      detail: [`requested ${request.requested_billing_mode}, authorized ${request.authorized_billing_mode}`],
    };
  }
  const missing = request.required_capabilities.filter(name => request.report_capabilities.get(name) !== 'observed_working');
  if (missing.length > 0) {
    return { admitted: false, reason: 'CAPABILITY_NOT_OBSERVED', detail: missing };
  }
  return { admitted: true };
}

/** Target capabilities are probed against the target, never inferred from the toolkit host.
 *
 * A tool answering is not a target existing. `adb devices` exits zero on a machine with no
 * phone attached, and `xcrun simctl` exits zero with no runtimes installed. `indicates_available`
 * is where that difference is read out of the tool's own output, so the tool being present
 * lands at `configured` and only a real target reaches `observed_working`. */
export type TargetProbe = {
  name: string;
  target: string;
  probe: () => Promise<ProbeOutcome>;
  indicates_available?: (outcome: ProbeOutcome) => boolean;
};

export async function probeTargetPrerequisites(probes: TargetProbe[]): Promise<Array<Capability & { target: string; tool_answered: boolean }>> {
  const results: Array<Capability & { target: string; tool_answered: boolean }> = [];
  for (const entry of probes) {
    const outcome = await entry.probe();
    const tool_answered = outcome.ran && outcome.exit_code === 0;
    const available = tool_answered && (entry.indicates_available === undefined || entry.indicates_available(outcome));
    results.push({
      name: entry.name, target: entry.target, tool_answered,
      documented: true, configured: tool_answered,
      observed_working: available,
      evidence_refs: [`target-probe:${entry.name}:exit${String(outcome.exit_code)}:${available ? 'target_present' : 'target_absent'}`],
      limitation: available
        ? 'The target exists and its tool answered. Building and running the actual deliverable is a separate check.'
        : tool_answered
          ? 'The tool is installed but reported no usable target on this host; the affected scope stays unverified.'
          : 'Target prerequisite not available on this host; the affected scope stays unverified.',
    });
  }
  return results;
}

export { invoke as probeCommand };
