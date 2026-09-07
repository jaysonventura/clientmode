/** Shared provider surface types.
 *
 * The adapter contract itself lives in contracts/interfaces.ts and is re-exported here so a
 * provider package never grows a second, incompatible definition.
 */
export type { ProviderAdapter, ProviderContext, ProviderEvent, ProviderName, CapabilityReport, Capability, BillingMode } from '../../../contracts/interfaces.js';

/** Three states, and the difference between the middle and the last one is the whole point:
 * `configured` means someone declared it, `observed_working` means a probe ran and succeeded. */
export type CapabilityState = 'unavailable' | 'configured' | 'observed_working';

/** Where the controller is talking to the provider. These are different surfaces with
 * different authentication and billing, and one does not imply another. */
export type HostSurface = 'native_cli' | 'sdk' | 'app_server' | 'mock';

export type ProbeOutcome = {
  ran: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the host answered but in a shape this version does not understand. */
  unrecognised_schema?: boolean;
};

export type CapabilityProbe = {
  name: string;
  /** Present in the provider's published documentation for this host version. */
  documented: boolean;
  /** Declared in local configuration or detected as installed. */
  configured: () => boolean;
  /** A disposable read-only probe. Absent means the capability can never exceed `configured`. */
  probe?: (host: DetectedHost) => Promise<ProbeOutcome>;
  /** What is still not established even when the probe succeeds. */
  limitation: string | null;
};

export type DetectedHost = {
  provider: 'claude' | 'codex' | 'mock';
  surface: HostSurface;
  installed: boolean;
  executable_path: string | null;
  version: string | null;
  version_recognised: boolean;
  sdk_version: string | null;
};

export type AdmissionRequest = {
  report_capabilities: Map<string, CapabilityState>;
  required_capabilities: string[];
  requested_billing_mode: 'native_account' | 'approved_api';
  authorized_billing_mode: 'native_account' | 'approved_api';
  account_accessible: boolean;
};

export type Admission =
  | { admitted: true }
  | { admitted: false; reason: 'BLOCKED_ACCESS' | 'CAPABILITY_NOT_OBSERVED' | 'BILLING_MODE_NOT_AUTHORIZED'; detail: string[] };
