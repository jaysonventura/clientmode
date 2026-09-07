/** Which environment must actually observe a component, and whether this host can provide it.
 *
 * The rule the handoff cares about: a web run never stands in for a native, service, data or
 * model deliverable. Resolution therefore returns the required target and, separately,
 * whether it is available. An unavailable target blocks the affected scope only — safe work
 * on other components continues.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EngineeringComponent } from '../../../contracts/interfaces.js';

export type TargetKind = 'web' | 'native-macos' | 'native-ios' | 'native-android' | 'service' | 'model' | 'data' | 'unknown';

export type TargetRequirement = {
  component_id: string;
  target: TargetKind;
  required_tools: string[];
  /** What an observation of this component has to be, in plain terms. */
  evidence_must_be: string;
};

export type TargetResolution = TargetRequirement & {
  available: boolean;
  missing: string[];
  detail: string;
};

const PLATFORM_HINTS: Array<[TargetKind, (component: EngineeringComponent) => boolean, string[], string]> = [
  ['native-ios', component => component.target_platforms.some(target => /^ios$/i.test(target)), ['xcrun', 'swiftc'],
    'Interaction with the built app on an iOS simulator or device. A browser screenshot is not this.'],
  ['native-android', component => component.target_platforms.some(target => /^android$/i.test(target)), ['adb'],
    'Interaction with the built app on an Android emulator or device.'],
  ['native-macos', component => component.target_platforms.some(target => /^macos$/i.test(target)), ['swiftc'],
    'Execution of the compiled macOS binary and observation of its real behaviour.'],
  ['model', component => /model|llm|rag|eval/i.test(component.domain), [],
    'A scored evaluation over a fixed dataset with grounded-answer checks. No web substitute.'],
  ['data', component => /data|pipeline|etl/i.test(component.domain), [],
    'Observed pipeline output over representative input, with row-level assertions.'],
  ['service', component => component.target_platforms.some(target => /^(server|linux|jvm)$/i.test(target)), [],
    'Requests against the running service, including failure and authorization paths.'],
  ['web', component => component.target_platforms.some(target => /^(browser|web)$/i.test(target)), ['node'],
    'Real browser journeys at the declared viewports with console and network observation.'],
];

function toolAvailable(tool: string): boolean {
  const searchPath = (process.env['PATH'] ?? '').split(path.delimiter);
  if (searchPath.some(directory => directory !== '' && existsSync(path.join(directory, tool)))) return true;
  return existsSync(path.join('/usr/bin', tool));
}

export function resolveTarget(component: EngineeringComponent): TargetResolution {
  const match = PLATFORM_HINTS.find(([, predicate]) => predicate(component));
  const [target, , tools, evidence] = match ?? (['unknown', () => false, [], 'Undetermined target; ground the component before claiming any result.'] as const);
  const required_tools = [...tools];
  const missing = required_tools.filter(tool => !toolAvailable(tool));
  let detail = missing.length === 0 ? 'All named tools resolve on this host.' : `Missing on this host: ${missing.join(', ')}`;

  if (target === 'native-ios') {
    const simulators = listIosSimulators();
    if (simulators.length === 0) {
      missing.push('ios-simulator');
      detail = 'No iOS simulator runtime is available on this host.';
    } else {
      detail = `${simulators.length} iOS simulator device(s) available, for example ${simulators[0]?.name}.`;
    }
  }

  return {
    component_id: component.component_id, target, required_tools,
    evidence_must_be: evidence, available: missing.length === 0, missing, detail,
  };
}

export type Simulator = { udid: string; name: string; runtime: string; state: string };

/** Real device list from the platform toolchain, not an assumption about the host. */
export function listIosSimulators(): Simulator[] {
  if (os.platform() !== 'darwin' || !toolAvailable('xcrun')) return [];
  try {
    const raw = execFileSync('xcrun', ['simctl', 'list', '-j', 'devices', 'available'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const parsed = JSON.parse(raw) as { devices: Record<string, Array<{ udid: string; name: string; state: string; isAvailable?: boolean }>> };
    return Object.entries(parsed.devices).flatMap(([runtime, devices]) =>
      devices.filter(device => device.isAvailable !== false)
        .map(device => ({ udid: device.udid, name: device.name, runtime, state: device.state })));
  } catch {
    return [];
  }
}

/** A web observation may never be offered for a non-web target. */
export function isSubstitution(requirement: TargetRequirement, observed_target: TargetKind): boolean {
  return requirement.target !== observed_target;
}
