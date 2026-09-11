/** `cm doctor` — what is installed, what was configured, and what was actually observed.
 *
 * The report separates those three states deliberately. An operator reading it should be able
 * to tell, for every line, whether the thing was seen working or merely declared. Optional
 * capabilities stay off until an approval names them; a missing one narrows what the toolkit
 * will admit rather than degrading quietly.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CapabilityReport } from '../../../contracts/interfaces.js';
import {
  detectCapabilities, detectHost, environmentFingerprint, probeCommand, probeTargetPrerequisites,
  type DetectionResult, type TargetProbe,
} from '../../../packages/providers/src/capabilities.js';
import type { CapabilityProbe, DetectedHost, HostSurface } from '../../../packages/providers/src/interface.js';

/** Directories a provider host may legitimately live in. Anything else is not executed.
 * On Windows these are where each host's documented installer puts it: the native Claude and
 * Cursor installers under the profile, the Codex installer under LocalAppData, npm globals under
 * AppData, and winget's links. */
export function defaultTrustedRoots(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') {
    const profile = env['USERPROFILE'] ?? '';
    const local = env['LOCALAPPDATA'] ?? path.join(profile, 'AppData', 'Local');
    const roaming = env['APPDATA'] ?? path.join(profile, 'AppData', 'Roaming');
    return [
      path.join(profile, '.local', 'bin'),
      path.join(roaming, 'npm'),
      path.join(local, 'Programs'),
      path.join(local, 'Microsoft', 'WinGet', 'Links'),
      path.join(env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs'),
      path.join(profile, '.client-mode', 'runtime'),
    ].filter(root => path.isAbsolute(root));
  }
  const home = env['HOME'] ?? '';
  return [
    '/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin',
    path.join(home, '.local/bin'),
    path.join(home, '.asdf/installs'),
    path.join(home, '.bun/bin'),
    path.join(home, '.client-mode', 'runtime'),
  ];
}

export const DEFAULT_TRUSTED_ROOTS = defaultTrustedRoots();

export type HostSpec = {
  provider: 'claude' | 'codex' | 'mock';
  surface: HostSurface;
  executable: string;
  sdk_package?: string;
  env?: NodeJS.ProcessEnv;
  trusted_roots?: string[];
};

/** Read-only probes only. Nothing here starts a model turn or spends anything. */
export function standardProbes(spec: HostSpec): CapabilityProbe[] {
  return [
    {
      name: 'host_version',
      documented: true,
      configured: () => true,
      probe: async host => host.executable_path === null
        ? { ran: false, exit_code: null, stdout: '', stderr: 'host not installed' }
        : { ...(await probeCommand(host.executable_path, ['--version'], spec.env ?? {})), unrecognised_schema: !host.version_recognised },
      limitation: 'A version number establishes the host is present, not that any account or feature works.',
    },
    {
      name: 'mcp_registry',
      documented: true,
      configured: () => true,
      probe: async host => host.executable_path === null
        ? { ran: false, exit_code: null, stdout: '', stderr: 'host not installed' }
        : probeCommand(host.executable_path, ['mcp', 'list'], spec.env ?? {}),
      limitation: 'Listing the registry is not permission to enable a server; optional MCP stays disabled until an approval names a capability.',
    },
    {
      name: 'sdk_transport',
      documented: spec.sdk_package !== undefined,
      // Installed is configured. It becomes observed only when a transport probe exists and runs.
      configured: () => spec.sdk_package !== undefined && moduleInstalled(spec.sdk_package),
      limitation: 'The SDK package being installed says nothing about authentication or billing on this machine.',
    },
    {
      name: 'browser_control',
      documented: false,
      // No documented, probeable browser-control surface on this host version.
      configured: () => false,
      limitation: 'No documented browser-control surface was detected for this host; browser evidence comes from the controller-owned probes instead.',
    },
    {
      name: 'goal_continuation',
      documented: false,
      configured: () => false,
      limitation: 'Version-dependent continuation behaviour is not assumed. Unknown means unavailable.',
    },
  ];
}

function moduleInstalled(specifier: string): boolean {
  return existsSync(path.join(process.cwd(), 'node_modules', specifier));
}

export type DoctorReport = {
  generated_at: string;
  toolkit: { node: string; platform: string; fingerprint: string };
  hosts: Array<{
    provider: string; surface: string; installed: boolean; version: string | null;
    version_recognised: boolean; report: CapabilityReport; fingerprint: string;
  }>;
  targets: Array<{ name: string; target: string; tool_answered: boolean; observed_working: boolean; limitation: string | null }>;
  /** Everything the operator should not read as working. */
  gaps: string[];
  exit_code: number;
};

export async function doctor(input: {
  hosts: HostSpec[];
  billing_mode: 'native_account' | 'approved_api' | 'unknown';
  target_probes?: TargetProbe[];
  required_capabilities?: string[];
  now: string;
}): Promise<{ report: DoctorReport; detections: DetectionResult[] }> {
  const detections: DetectionResult[] = [];
  const hosts: DoctorReport['hosts'] = [];
  const gaps: string[] = [];

  for (const spec of input.hosts) {
    const host: DetectedHost = await detectHost({
      provider: spec.provider, surface: spec.surface, executable: spec.executable,
      trusted_roots: spec.trusted_roots ?? DEFAULT_TRUSTED_ROOTS,
      ...(spec.sdk_package === undefined ? {} : { sdk_package: spec.sdk_package }),
      ...(spec.env === undefined ? {} : { env: spec.env }),
    });
    const detection = await detectCapabilities({
      host, probes: standardProbes(spec), billing_mode: input.billing_mode, observed_at: input.now,
    });
    detections.push(detection);
    hosts.push({
      provider: spec.provider, surface: spec.surface, installed: host.installed,
      version: host.version, version_recognised: host.version_recognised,
      report: detection.report, fingerprint: environmentFingerprint(host),
    });
    if (!host.installed) gaps.push(`${spec.provider}: host not installed or not on a trusted path`);
    if (host.installed && !host.version_recognised) gaps.push(`${spec.provider}: host version output not recognised; capabilities held at configured`);
    for (const capability of detection.report.capabilities) {
      if (!capability.observed_working) gaps.push(`${spec.provider}.${capability.name}: ${capability.configured ? 'configured but not observed working' : 'unavailable'}`);
    }
  }

  const targets = (await probeTargetPrerequisites(input.target_probes ?? []))
    .map(capability => ({ name: capability.name, target: capability.target, tool_answered: capability.tool_answered, observed_working: capability.observed_working, limitation: capability.limitation }));
  for (const target of targets) {
    if (!target.observed_working) {
      gaps.push(`target ${target.target}: ${target.name} ${target.tool_answered ? 'tool installed but no usable target' : 'not available'}`);
    }
  }

  const required = input.required_capabilities ?? [];
  const unmet = required.filter(name => !detections.some(detection => detection.states.get(name) === 'observed_working'));
  const report: DoctorReport = {
    generated_at: input.now,
    toolkit: { node: process.versions.node, platform: `${process.platform}-${process.arch}`, fingerprint: environmentFingerprint(detections[0]?.host ?? { provider: 'mock', surface: 'mock', installed: false, executable_path: null, version: null, version_recognised: false, sdk_version: null }) },
    hosts, targets, gaps, exit_code: unmet.length === 0 ? 0 : 1,
  };
  return { report, detections };
}
