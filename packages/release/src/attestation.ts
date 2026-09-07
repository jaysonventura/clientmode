/** Release attestation.
 *
 * An attestation says: this exact artifact, built from this exact source, under this policy
 * and requirements revision, was verified by this evidence. Promotion later checks the
 * artifact it is about to ship against the attestation, so a rebuild — which produces new
 * bytes — cannot ride on the previous verification.
 */
import { createHash } from 'node:crypto';
import type { Candidate, Verdict } from '../../../contracts/interfaces.js';
import { digest } from '../../contracts/src/canonical.js';

export type Attestation = {
  kind: 'release_attestation';
  schema_version: 1;
  attestation_id: string;
  project_id: string;
  candidate_id: string;
  source_digest: string;
  artifact_digest: string;
  policy_digest: string;
  environment_digest: string;
  requirements_revision: number;
  evidence_id: string;
  composite_manifest_digest: string | null;
  issued_at: string;
  issuer_id: string;
};

export class AttestationError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'AttestationError';
  }
}

/** Only a VERIFIED_FOR_SCOPE verdict for this candidate produces an attestation. */
export function attest(input: {
  candidate: Candidate; verdict: Verdict; issuer_id: string; issued_at: string;
  composite_manifest_digest?: string | null;
}): Attestation {
  if (input.verdict.verdict !== 'VERIFIED_FOR_SCOPE') throw new AttestationError('CANDIDATE_NOT_VERIFIED', input.verdict.reasons.join(','));
  if (input.verdict.candidate_id !== input.candidate.candidate_id) throw new AttestationError('VERDICT_CANDIDATE_MISMATCH', String(input.verdict.candidate_id));
  if (input.verdict.evidence_id === undefined) throw new AttestationError('VERDICT_WITHOUT_EVIDENCE');
  const body: Omit<Attestation, 'attestation_id'> = {
    kind: 'release_attestation', schema_version: 1,
    project_id: input.candidate.project_id, candidate_id: input.candidate.candidate_id,
    source_digest: input.candidate.source_digest, artifact_digest: input.candidate.artifact_digest,
    policy_digest: input.candidate.policy_digest, environment_digest: input.candidate.environment_digest,
    requirements_revision: input.candidate.requirements_revision,
    evidence_id: input.verdict.evidence_id,
    composite_manifest_digest: input.composite_manifest_digest ?? null,
    issued_at: input.issued_at, issuer_id: input.issuer_id,
  };
  return { ...body, attestation_id: `att_${createHash('sha256').update(digest(body)).digest('hex').slice(0, 32)}` };
}

export type PromotionCheck = { promotable: boolean; reasons: string[] };

/** What the release service asks immediately before promoting bytes to an environment. */
export function checkPromotable(input: {
  attestation: Attestation;
  artifact_digest_to_promote: string;
  current_policy_digest: string;
  current_requirements_revision: number;
  current_composite_manifest_digest?: string | null;
  target_environment: string;
  approved_environment: string;
}): PromotionCheck {
  const reasons: string[] = [];
  if (input.attestation.artifact_digest !== input.artifact_digest_to_promote) reasons.push('ARTIFACT_DIGEST_CHANGED');
  if (input.attestation.policy_digest !== input.current_policy_digest) reasons.push('POLICY_CHANGED');
  if (input.attestation.requirements_revision !== input.current_requirements_revision) reasons.push('REQUIREMENTS_REVISION_CHANGED');
  if ((input.attestation.composite_manifest_digest ?? null) !== (input.current_composite_manifest_digest ?? null)) {
    reasons.push('COMPOSITE_MANIFEST_CHANGED');
  }
  if (input.target_environment !== input.approved_environment) reasons.push('ENVIRONMENT_NOT_APPROVED');
  return { promotable: reasons.length === 0, reasons };
}
