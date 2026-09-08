/** `cm` — the command surface from docs/OPERATIONS.md.
 *
 * The exit codes are part of the contract, not decoration: an operator and a CI job both need
 * to tell a missing capability from a rejected verification from a denied authorization. A
 * zero here means the command did what it said within its stated scope, and nothing more — it
 * is never a product readiness verdict.
 */
export const EXIT_CODES = {
  ok: 0,
  input_or_contract_error: 2,
  missing_capability: 3,
  verification_not_accepted: 4,
  authorization_required: 5,
  budget_or_no_progress: 6,
  integrity_or_security: 7,
  internal: 8,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export type CommandSpec = {
  name: string;
  arguments: string[];
  summary: string;
  /** What this command may never do, stated where it can be tested. */
  refuses: string[];
};

export const COMMANDS: CommandSpec[] = [
  { name: 'doctor', arguments: ['--json'], summary: 'Report installed, configured and observed capability separately.', refuses: ['reporting a configured capability as observed'] },
  { name: 'install', arguments: ['--host', '--dry-run'], summary: 'Show the change set, then apply it with backups.', refuses: ['applying an unapproved plan', 'replacing a settings file'] },
  { name: 'uninstall', arguments: ['--host'], summary: 'Remove only owned artifacts and settings.', refuses: ['removing project work', 'removing retained evidence'] },
  { name: 'upgrade', arguments: ['--version'], summary: 'Snapshot, migrate, then activate.', refuses: ['activating before the migration commits'] },
  { name: 'open', arguments: ['[PROJECT]'], summary: 'Open the authenticated quiet console.', refuses: ['registering a project root that was not chosen'] },
  { name: 'run', arguments: ['--project', '--request-file'], summary: 'Create an idempotent run from an authorized local file.', refuses: ['reading a file outside the authorized root'] },
  { name: 'pause', arguments: ['RUN'], summary: 'Stop new work and attempt controlled interruption.', refuses: ['claiming external effects stopped'] },
  { name: 'resume', arguments: ['RUN'], summary: 'Resume from reconciled state.', refuses: ['inventing progress that was not recorded'] },
  { name: 'cancel', arguments: ['RUN'], summary: 'Revoke leases and record intent.', refuses: ['reporting a process tree as dead without checking'] },
  { name: 'handoff', arguments: ['--json'], summary: 'Brief the next session from durable state, whichever host it is.', refuses: ['reporting in-flight work as finished'] },
  { name: 'use', arguments: ['HOST'], summary: 'Choose which host a bare `cm` starts.', refuses: ['starting a host that is not installed'] },
  { name: 'start', arguments: ['--host'], summary: 'Start the preferred host here, with the handoff briefing.', refuses: ['inventing progress the controller did not record'] },
  { name: 'status', arguments: ['RUN', '--json'], summary: 'Structured status, pending authority and readiness tier.', refuses: ['merging readiness with client acceptance'] },
  { name: 'verify', arguments: ['--candidate'], summary: 'Request the protected checks for a candidate.', refuses: ['accepting a caller-supplied command string'] },
  { name: 'export-evidence', arguments: ['--candidate'], summary: 'Export signed records with secrets redacted.', refuses: ['exporting under an active retention lock without saying so'] },
  { name: 'rollback', arguments: ['--toolkit-version', '--deployment', '--approval'], summary: 'Restore a compatible version, or execute an authorized deployment recovery.', refuses: ['rolling back across an irreversible migration'] },
];

export function commandNames(): string[] {
  return COMMANDS.map(command => command.name);
}

export function describe(name: string): CommandSpec | undefined {
  return COMMANDS.find(command => command.name === name);
}
