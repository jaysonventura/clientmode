/** The predeclared benchmark task families and the pilot task specs.
 *
 * The families are declared before any trial runs, and results are retained per family. A
 * single blended number is not a result: a toolkit that does well on web work and badly on
 * systems work must show both, because a client only ever has one of them.
 */

export const ENGINEERING_FAMILIES = [
  'web', 'non_js_backend', 'native', 'systems', 'llm', 'polyglot', 'unfamiliar_stack',
] as const;
export type EngineeringFamily = (typeof ENGINEERING_FAMILIES)[number];

export type TaskSpec = {
  spec_id: string;
  family: EngineeringFamily;
  title: string;
  /** The frozen repository snapshot every arm and repeat of this spec runs against. */
  snapshot_digest: string;
  /** Environments the task genuinely needs. A missing one is a blocked run, never a pass. */
  requires_environment: string[];
  /** Fraction of candidates the simulated worker produces with a defect, fixed per spec and
   * never adjusted after seeing a result. */
  defect_rate: number;
  /** Whether the defect is one ordinary unit tests can see. Semantic defects are the ones
   * that separate the arms. */
  defect_visible_to_unit_tests: boolean;
};

const spec = (
  spec_id: string, family: EngineeringFamily, title: string,
  requires_environment: string[], defect_rate: number, visible: boolean,
): TaskSpec => ({
  spec_id, family, title,
  snapshot_digest: `sha256:${spec_id.padEnd(64, '0').slice(0, 64)}`,
  requires_environment, defect_rate, defect_visible_to_unit_tests: visible,
});

/** 20 pilot specs, balanced across the seven predeclared families. */
export const PILOT_SPECS: readonly TaskSpec[] = [
  spec('web_checkout_total', 'web', 'Correct the checkout total shown to the client', ['node'], 0.34, true),
  spec('web_mobile_overflow', 'web', 'Remove horizontal overflow at a phone viewport', ['node', 'chromium'], 0.34, false),
  spec('web_form_labels', 'web', 'Give every checkout control an accessible name', ['node', 'chromium'], 0.34, false),
  spec('web_error_state', 'web', 'Show a recoverable error state when the API fails', ['node', 'chromium'], 0.34, false),
  spec('backend_quantity_bounds', 'non_js_backend', 'Enforce order quantity bounds in the pricing service', ['python3'], 0.34, true),
  spec('backend_idempotency', 'non_js_backend', 'Make order submission idempotent', ['python3'], 0.34, false),
  spec('backend_authorisation', 'non_js_backend', 'Reject an order priced by the client', ['python3'], 0.34, false),
  spec('native_pricing_total', 'native', 'Correct the total in the macOS pricing binary', ['swiftc'], 0.34, true),
  spec('native_currency_units', 'native', 'Stop mixing centavos and pesos in the native view', ['swiftc'], 0.34, false),
  spec('native_ios_layout', 'native', 'Fix the iOS layout at the smallest supported size', ['xcodebuild', 'simctl'], 0.34, false),
  spec('systems_lease_fencing', 'systems', 'Fence a returning worker out of a reassigned lease', ['node'], 0.34, true),
  spec('systems_crash_recovery', 'systems', 'Recover in-flight work after an abrupt controller exit', ['node'], 0.34, false),
  spec('systems_process_group', 'systems', 'Stop a forked grandchild when its attempt is cancelled', ['node'], 0.34, false),
  spec('llm_grounded_answer', 'llm', 'Answer only from the retrieved corpus revision', ['node'], 0.34, true),
  spec('llm_citation_integrity', 'llm', 'Refuse a citation the corpus does not support', ['node'], 0.34, false),
  spec('polyglot_shared_contract', 'polyglot', 'Keep one contract honest across Swift, Python and TypeScript', ['node', 'python3', 'swiftc'], 0.34, false),
  spec('polyglot_build_matrix', 'polyglot', 'Build every component of the polyglot fixture', ['node', 'python3', 'go'], 0.34, false),
  spec('unfamiliar_kotlin_service', 'unfamiliar_stack', 'Change a Kotlin service the toolkit has not seen', ['kotlinc'], 0.34, false),
  spec('unfamiliar_go_worker', 'unfamiliar_stack', 'Change a Go worker the toolkit has not seen', ['go'], 0.34, false),
  spec('unfamiliar_rust_parser', 'unfamiliar_stack', 'Change a Rust parser the toolkit has not seen', ['cargo'], 0.34, false),
];

export const ARMS = ['native_single', 'clientmode_single', 'clientmode_bounded_agents'] as const;
export type Arm = (typeof ARMS)[number];
