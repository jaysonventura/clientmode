/** AT-009 executor.
 *
 * Detection runs against four host fixtures — absent, supported, unrecognised schema, expired
 * account — and against the two provider CLIs actually installed on this machine. Every probe
 * is read-only: `--version` and `mcp list`. Nothing here starts a model turn or spends
 * anything, so a green result is a statement about detection, not about any account.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { admitProviderJob, isTrustedExecutablePath, probeCommand } from '../../packages/providers/src/capabilities.js';
import { doctor, DEFAULT_TRUSTED_ROOTS, type HostSpec } from '../../apps/cli/src/doctor.js';
import { Evidence, ROOT, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const NOW = '2026-09-08T11:00:00.000Z';

/** Wrap the fixture host in an executable shim so detection resolves it exactly as it would a
 * real CLI: from a directory, by path, with no shell involved. */
function installFixtureHost(binDir: string, name: string, mode: string): string {
  mkdirSync(binDir, { recursive: true });
  const shim = path.join(binDir, name);
  writeFileSync(shim, `#!/bin/sh\nFAKE_HOST_MODE=${mode} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(ROOT, 'fixtures/provider-hosts/fake-host.mjs'))} "$@"\n`);
  chmodSync(shim, 0o755);
  return shim;
}

registerScenario('AT-009', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T09');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t09-'));
  const binDir = path.join(sandbox, 'bin');
  const log: Record<string, unknown> = {};

  try {
    installFixtureHost(binDir, 'host-supported', 'supported');
    installFixtureHost(binDir, 'host-unknown-schema', 'unknown-schema');
    installFixtureHost(binDir, 'host-expired', 'expired-account');
    installFixtureHost(binDir, 'host-no-mcp', 'no-mcp');
    const fixtureRoots = [binDir];

    const fixtureSpec = (executable: string): HostSpec => ({
      provider: 'mock', surface: 'native_cli', executable, trusted_roots: fixtureRoots,
    });

    // 1. Absent host, supported host, unrecognised schema, expired account.
    const absent = await doctor({ hosts: [fixtureSpec('host-that-is-not-installed')], billing_mode: 'unknown', now: clock() });
    const supported = await doctor({ hosts: [fixtureSpec('host-supported')], billing_mode: 'native_account', now: clock() });
    const unknownSchema = await doctor({ hosts: [fixtureSpec('host-unknown-schema')], billing_mode: 'native_account', now: clock() });
    const expired = await doctor({ hosts: [fixtureSpec('host-expired')], billing_mode: 'native_account', now: clock() });
    const noMcp = await doctor({ hosts: [fixtureSpec('host-no-mcp')], billing_mode: 'native_account', now: clock() });

    const capabilityOf = (result: Awaited<ReturnType<typeof doctor>>, name: string) =>
      result.report.hosts[0]?.report.capabilities.find(capability => capability.name === name);

    log['fixture_hosts'] = {
      absent: { installed: absent.report.hosts[0]?.installed, exit_code: absent.report.exit_code, gaps: absent.report.gaps },
      supported: { version: supported.report.hosts[0]?.version, recognised: supported.report.hosts[0]?.version_recognised, capabilities: supported.report.hosts[0]?.report.capabilities },
      unknown_schema: { version: unknownSchema.report.hosts[0]?.version, recognised: unknownSchema.report.hosts[0]?.version_recognised, capabilities: unknownSchema.report.hosts[0]?.report.capabilities },
      expired_account: { mcp: capabilityOf(expired, 'mcp_registry'), gaps: expired.report.gaps },
      missing_subcommand: { mcp: capabilityOf(noMcp, 'mcp_registry') },
    };

    // An unrecognised host answer must not produce a working capability anywhere.
    const unknownCapabilityNotEnabled =
      unknownSchema.report.hosts[0]?.version_recognised === false &&
      (unknownSchema.report.hosts[0]?.report.capabilities ?? []).every(capability => !capability.observed_working) &&
      capabilityOf(expired, 'mcp_registry')?.observed_working === false &&
      capabilityOf(noMcp, 'mcp_registry')?.observed_working === false &&
      capabilityOf(supported, 'goal_continuation')?.observed_working === false;

    // 2. Configured is never reported as tested. The SDK is installed but has no probe.
    const sdkSpec: HostSpec = { provider: 'mock', surface: 'sdk', executable: 'host-supported', trusted_roots: fixtureRoots, sdk_package: 'playwright' };
    const withSdk = await doctor({ hosts: [sdkSpec], billing_mode: 'native_account', now: clock() });
    const sdkCapability = capabilityOf(withSdk, 'sdk_transport');
    log['configured_versus_observed'] = {
      sdk: sdkCapability,
      version_probe: capabilityOf(withSdk, 'host_version'),
      gaps_mention_configured_not_observed: withSdk.report.gaps.filter(gap => gap.includes('configured but not observed')),
    };
    const configuredNotTested = sdkCapability?.configured === true && sdkCapability.observed_working === false &&
      sdkCapability.evidence_refs.some(reference => reference.includes('no_probe_available')) &&
      capabilityOf(withSdk, 'host_version')?.observed_working === true;

    // 3. No account means blocked. There is no fallback to metered billing or another provider.
    const observedStates = supported.detections[0]!.states;
    const admissions = {
      no_account: admitProviderJob({ report_capabilities: observedStates, required_capabilities: ['host_version'], requested_billing_mode: 'native_account', authorized_billing_mode: 'native_account', account_accessible: false }),
      unapproved_api: admitProviderJob({ report_capabilities: observedStates, required_capabilities: ['host_version'], requested_billing_mode: 'approved_api', authorized_billing_mode: 'native_account', account_accessible: true }),
      unobserved_capability: admitProviderJob({ report_capabilities: observedStates, required_capabilities: ['goal_continuation'], requested_billing_mode: 'native_account', authorized_billing_mode: 'native_account', account_accessible: true }),
      authorized: admitProviderJob({ report_capabilities: observedStates, required_capabilities: ['host_version'], requested_billing_mode: 'native_account', authorized_billing_mode: 'native_account', account_accessible: true }),
    };
    // A host path arriving from untrusted content is never executed.
    const injectedPath = '/tmp/attacker-supplied/claude';
    const trustedPathCheck = {
      injected: isTrustedExecutablePath(injectedPath, DEFAULT_TRUSTED_ROOTS),
      relative: isTrustedExecutablePath('./claude', DEFAULT_TRUSTED_ROOTS),
      fixture: isTrustedExecutablePath(path.join(binDir, 'host-supported'), fixtureRoots),
    };
    log['admission'] = { admissions, trusted_path: trustedPathCheck };
    const billingFallbackDenied =
      admissions.no_account.admitted === false && admissions.no_account.reason === 'BLOCKED_ACCESS' &&
      admissions.unapproved_api.admitted === false && admissions.unapproved_api.reason === 'BILLING_MODE_NOT_AUTHORIZED' &&
      admissions.unobserved_capability.admitted === false && admissions.unobserved_capability.reason === 'CAPABILITY_NOT_OBSERVED' &&
      admissions.authorized.admitted === true &&
      trustedPathCheck.injected === false && trustedPathCheck.relative === false && trustedPathCheck.fixture === true;

    // 4 and 5. Browser control and optional MCP are both explicit, and neither is enabled.
    const browser = capabilityOf(supported, 'browser_control');
    const mcp = capabilityOf(supported, 'mcp_registry');
    log['optional_capabilities'] = { browser, mcp, gaps: supported.report.gaps };
    const browserGapExplicit = browser !== undefined && browser.observed_working === false &&
      browser.configured === false && browser.documented === false &&
      typeof browser.limitation === 'string' && browser.limitation.length > 0 &&
      supported.report.gaps.some(gap => gap.includes('browser_control'));
    // The registry can be listed; that is not permission to enable a server.
    const mcpDisabled = mcp !== undefined && typeof mcp.limitation === 'string' &&
      mcp.limitation.includes('until an approval names a capability') &&
      admitProviderJob({
        report_capabilities: observedStates, required_capabilities: ['mcp:filesystem'],
        requested_billing_mode: 'native_account', authorized_billing_mode: 'native_account', account_accessible: true,
      }).admitted === false;

    // 6. Node being present proves nothing about a target environment.
    const targets = await doctor({
      hosts: [fixtureSpec('host-supported')], billing_mode: 'native_account', now: clock(),
      target_probes: [
        {
          name: 'ios_simulator_runtimes', target: 'iOS',
          probe: () => probeCommand('/usr/bin/xcrun', ['simctl', 'list', '-j', 'runtimes']),
          indicates_available: outcome => {
            try {
              return (JSON.parse(outcome.stdout) as { runtimes?: unknown[] }).runtimes!.length > 0;
            } catch { return false; }
          },
        },
        {
          name: 'android_device_bridge', target: 'Android',
          probe: () => probeCommand('/usr/bin/env', ['adb', 'devices']),
          // adb exits zero with no phone attached. An empty list is an absent target.
          indicates_available: outcome => outcome.stdout.split('\n').slice(1).some(line => /\tdevice$/.test(line.trim())),
        },
        {
          // The rule under test is "the tool answered" is not "the target is there", and it has
          // to hold whatever hardware happens to be plugged into the machine running the gate.
          // This probe answers successfully and reports nothing attached, every time.
          name: 'android_device_bridge_no_device', target: 'Android-no-device',
          probe: () => probeCommand('/usr/bin/printf', ['List of devices attached\n\n']),
          indicates_available: outcome => outcome.stdout.split('\n').slice(1).some(line => /\tdevice$/.test(line.trim())),
        },
        {
          name: 'toolchain_present_fixture', target: 'fixture-present',
          probe: () => probeCommand('/usr/bin/printf', ['ready\n']),
          indicates_available: outcome => outcome.stdout.includes('ready'),
        },
        { name: 'authorized_model_runner', target: 'model-serving', probe: () => probeCommand('/usr/bin/env', ['authorized-model-runner', '--version']) },
      ],
    });
    log['target_prerequisites'] = { toolkit_node: process.versions.node, targets: targets.report.targets, gaps: targets.report.gaps.filter(gap => gap.startsWith('target ')) };
    const noDevice = targets.report.targets.find(target => target.target === 'Android-no-device');
    const model = targets.report.targets.find(target => target.target === 'model-serving');
    const present = targets.report.targets.find(target => target.target === 'fixture-present');
    // Node is present throughout, and none of the three verdicts may come from that. A tool that
    // answers but reports nothing attached is an absent target; a tool that is not installed is
    // an absent target; only a tool that answers *and* reports the thing is working. The live
    // iOS and Android probes above are recorded as observations — what they find depends on the
    // machine, so asserting on them would make this gate a report about the operator's desk.
    const toolkitNotTarget =
      noDevice?.tool_answered === true && noDevice.observed_working === false &&
      model?.tool_answered === false && model.observed_working === false &&
      present?.tool_answered === true && present.observed_working === true &&
      targets.report.gaps.some(gap => gap.startsWith('target Android-no-device')) &&
      targets.report.gaps.some(gap => gap.startsWith('target model-serving')) &&
      !targets.report.gaps.some(gap => gap.startsWith('target fixture-present'));

    // The real hosts on this machine, probed read-only and reported as found.
    const installedHosts: HostSpec[] = [
      { provider: 'claude', surface: 'native_cli', executable: 'claude', sdk_package: '@anthropic-ai/claude-agent-sdk' },
      { provider: 'codex', surface: 'native_cli', executable: 'codex', sdk_package: '@openai/codex-sdk' },
    ];
    const live = await doctor({ hosts: installedHosts, billing_mode: 'native_account', now: clock() });
    log['installed_hosts'] = live.report.hosts.map(host => ({
      provider: host.provider, installed: host.installed, version: host.version,
      version_recognised: host.version_recognised, sdk_version: host.report.sdk_version,
      capabilities: host.report.capabilities.map(capability => ({ name: capability.name, configured: capability.configured, observed_working: capability.observed_working })),
    }));
    const reportsValid = live.report.hosts.every(host => validateEntity(host.report).valid);

    await writer.write('capabilities.json', log);
    await writer.write('doctor-installed-hosts.json', live.report);
    await writer.write('doctor-fixture-hosts.json', { absent: absent.report, supported: supported.report, unknown_schema: unknownSchema.report, expired: expired.report });

    return {
      scenario_id: 'AT-009',
      mode: 'integration',
      observed: {
        unknown_capability_not_enabled: unknownCapabilityNotEnabled,
        configured_not_reported_as_tested: configuredNotTested,
        billing_fallback_denied: billingFallbackDenied,
        browser_gap_explicit: browserGapExplicit,
        unsupported_mcp_disabled: mcpDisabled,
        toolkit_runtime_not_target_capability: toolkitNotTarget,
        capability_reports_schema_valid: reportsValid,
        installed_claude_version: live.report.hosts.find(host => host.provider === 'claude')?.version ?? null,
        installed_codex_version: live.report.hosts.find(host => host.provider === 'codex')?.version ?? null,
        probe_scope: 'read_only_no_model_turn',
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
