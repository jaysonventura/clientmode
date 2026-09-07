/** Composite readiness across components.
 *
 * A candidate that ships a web app, a native binary, a service and a model is ready only when
 * every required component has its own observation from its own target. One green web subset
 * never approves an untested native or model component, and an unavailable environment blocks
 * the affected scope rather than the whole candidate.
 */
import { digest } from '../../contracts/src/canonical.js';
import type { TargetKind, TargetResolution } from './resolve.js';

export type ComponentObservation = {
  component_id: string;
  observed_target: TargetKind;
  status: 'PASSED' | 'FAILED' | 'UNVERIFIED';
  evidence_ref: string;
  detail: string;
};

export type CompositeVerdict = {
  verdict: 'VERIFIED_FOR_SCOPE' | 'UNVERIFIED';
  covered_components: string[];
  blocked_components: string[];
  substituted_components: string[];
  failed_components: string[];
  manifest_digest: string;
  reasons: string[];
};

/** The composite manifest names every required component and the interface versions between
 * them, so changing one required component invalidates the composite. */
export function compositeManifestDigest(input: {
  candidate_id: string;
  components: Array<{ component_id: string; artifact_digest: string; interface_version: string }>;
}): string {
  return digest({
    candidate_id: input.candidate_id,
    components: [...input.components].sort((a, b) => (a.component_id < b.component_id ? -1 : 1)),
  });
}

export function evaluateComposite(input: {
  requirements: TargetResolution[];
  observations: ComponentObservation[];
  manifest_digest: string;
}): CompositeVerdict {
  const byComponent = new Map(input.observations.map(observation => [observation.component_id, observation]));
  const covered: string[] = [];
  const blocked: string[] = [];
  const substituted: string[] = [];
  const failed: string[] = [];
  const reasons: string[] = [];

  for (const requirement of input.requirements) {
    const observation = byComponent.get(requirement.component_id);
    if (!observation) {
      blocked.push(requirement.component_id);
      reasons.push(`NO_OBSERVATION:${requirement.component_id}`);
      continue;
    }
    if (observation.observed_target !== requirement.target) {
      substituted.push(requirement.component_id);
      reasons.push(`TARGET_SUBSTITUTION:${requirement.component_id}:${observation.observed_target}!=${requirement.target}`);
      continue;
    }
    if (observation.status === 'UNVERIFIED') {
      blocked.push(requirement.component_id);
      reasons.push(`UNVERIFIED:${requirement.component_id}:${observation.detail}`);
      continue;
    }
    if (observation.status === 'FAILED') {
      failed.push(requirement.component_id);
      reasons.push(`FAILED:${requirement.component_id}:${observation.detail}`);
      continue;
    }
    covered.push(requirement.component_id);
  }

  const verdict = reasons.length === 0 ? 'VERIFIED_FOR_SCOPE' : 'UNVERIFIED';
  return {
    verdict, covered_components: covered, blocked_components: blocked,
    substituted_components: substituted, failed_components: failed,
    manifest_digest: input.manifest_digest, reasons,
  };
}
