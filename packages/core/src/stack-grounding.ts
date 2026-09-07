/** Stack grounding.
 *
 * An unfamiliar technology is a research task, not a rejection and not an excuse to convert
 * the component into the toolkit's own language. This module decides three things:
 *
 *   - what a task needs to be grounded in before it may be dispatched (the component's own
 *     manifests, the installed versions, first-party documentation for those versions);
 *   - whether a proposed plan is a conversion of the client's stack, which is refused;
 *   - whether a claim of expertise is backed by source references, because a blanket claim is
 *     worth nothing.
 */
import type { EngineeringComponent } from '../../../contracts/interfaces.js';

export class GroundingError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'GroundingError';
  }
}

export type SourceReference = {
  kind: 'repository_file' | 'installed_manifest' | 'first_party_documentation';
  ref: string;
  /** The version this reference was read for. A doc page without a version is not grounding. */
  version: string | null;
  observed_at: string;
};

export type GroundingRequest = {
  component: EngineeringComponent;
  references: SourceReference[];
  /** What the worker proposes to do, in the client's own stack terms. */
  proposed_languages: string[];
  /** Set when the worker asserts knowledge rather than citing a source. */
  asserted_expertise?: string[];
};

export type GroundingVerdict =
  | { grounded: true; component_id: string; references: SourceReference[] }
  | { grounded: false; component_id: string; reasons: string[]; next_actions: string[] };

/** The toolkit's own implementation language. A component is never migrated into it to make
 * verification convenient. */
export const TOOLKIT_LANGUAGES = ['TypeScript', 'JavaScript'] as const;

export function isToolkitConversion(component: EngineeringComponent, proposed_languages: string[]): boolean {
  const existing = component.languages.map(language => language.toLowerCase());
  if (existing.length === 0) return false;
  const proposed = proposed_languages.map(language => language.toLowerCase());
  const toolkit = TOOLKIT_LANGUAGES.map(language => language.toLowerCase());
  const droppedTheirs = existing.some(language => !toolkit.includes(language) && !proposed.includes(language));
  const addedOurs = proposed.some(language => toolkit.includes(language) && !existing.includes(language));
  return droppedTheirs && addedOurs;
}

/** Grounding is source references for this component at the versions actually installed. An
 * unfamiliar language is not a reason to refuse the task; it is a reason to read first. */
export function assessGrounding(request: GroundingRequest): GroundingVerdict {
  const reasons: string[] = [];
  const next_actions: string[] = [];

  const versioned = request.references.filter(reference => reference.version !== null);
  const fromRepository = request.references.filter(reference => reference.kind !== 'first_party_documentation');
  if (request.references.length === 0) {
    reasons.push('NO_SOURCE_REFERENCES');
    next_actions.push(`Read ${request.component.source_refs.slice(0, 3).join(', ') || 'the component manifests'} before proposing a change.`);
  }
  if (fromRepository.length === 0 && request.references.length > 0) {
    reasons.push('NO_REPOSITORY_GROUNDING');
    next_actions.push('Documentation alone is not grounding; read the project\'s own manifests and sources.');
  }
  if (versioned.length === 0 && request.references.length > 0) {
    reasons.push('REFERENCES_WITHOUT_VERSION');
    next_actions.push('Record the installed version each reference was read for.');
  }
  if ((request.asserted_expertise ?? []).length > 0 && request.references.length === 0) {
    reasons.push('UNSUPPORTED_EXPERTISE_CLAIM');
    next_actions.push('Replace the expertise claim with the sources it came from.');
  }
  if (isToolkitConversion(request.component, request.proposed_languages)) {
    reasons.push('TOOLKIT_STACK_CONVERSION_REFUSED');
    next_actions.push(`Implement in ${request.component.languages.join(', ')}; a migration needs separate authorization.`);
  }
  if (request.component.capability_gaps.length > 0 && request.component.grounding_status === 'BLOCKED') {
    reasons.push('COMPONENT_BLOCKED_BY_CAPABILITY_GAP');
    next_actions.push(...request.component.capability_gaps.map(gap => `Resolve or report: ${gap}`));
  }

  return reasons.length === 0
    ? { grounded: true, component_id: request.component.component_id, references: request.references }
    : { grounded: false, component_id: request.component.component_id, reasons, next_actions };
}

export type RoutingDecision = {
  component_id: string;
  implementation_languages: string[];
  review_languages: string[];
  /** Never 'reject because unfamiliar'. */
  disposition: 'route_native' | 'research_then_route' | 'blocked_by_environment';
  research_plan: string[];
};

/** Routing follows the component's own stack. An unrecognised language produces a research
 * plan and a native route, never a refusal and never a rewrite. */
export function routeByStack(component: EngineeringComponent, known_languages: readonly string[]): RoutingDecision {
  const languages = component.languages.length > 0 ? component.languages : ['undetermined'];
  const unfamiliar = languages.filter(language => !known_languages.some(known => known.toLowerCase() === language.toLowerCase()));
  if (component.grounding_status === 'BLOCKED' && component.capability_gaps.length > 0) {
    return {
      component_id: component.component_id, implementation_languages: languages, review_languages: languages,
      disposition: 'blocked_by_environment',
      research_plan: component.capability_gaps.map(gap => `Report the gap and continue safe work elsewhere: ${gap}`),
    };
  }
  return {
    component_id: component.component_id,
    implementation_languages: languages,
    review_languages: languages,
    disposition: unfamiliar.length > 0 ? 'research_then_route' : 'route_native',
    research_plan: unfamiliar.map(language =>
      `Read ${component.source_refs.slice(0, 2).join(', ') || 'the component sources'} and the first-party ${language} documentation for the installed version before implementing.`),
  };
}

/** A reviewer of a component works in that component's language, not the toolkit's. */
export function reviewerRoutingMatchesImplementation(decision: RoutingDecision): boolean {
  return decision.implementation_languages.join('|') === decision.review_languages.join('|');
}
