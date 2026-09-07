/** Cross-document reasoning.
 *
 * Findings are separated by what they are: something observed in a source, a conflict between
 * two sources, an inference drawn from them, a suggestion, or a piece of evidence that could
 * not be read. Facts and conflicts carry source references; a suggestion does not get to
 * borrow one. A conflict names both locations, because "these documents disagree" is not
 * useful without saying where.
 *
 * Text inside a document is data. An instruction found in a source is recorded as an
 * observation about the source and never followed.
 */
import { randomUUID } from 'node:crypto';
import type { DocumentCitation, DocumentFinding } from '../../../contracts/interfaces.js';

export class ReasoningError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'ReasoningError';
  }
}

export type FindingDraft = {
  classification: DocumentFinding['classification'];
  material: boolean;
  statement: string;
  citations: DocumentCitation[];
};

/** Facts and conflicts need citations; a conflict needs two, in different places. */
export function buildFinding(input: { job_id: string; project_id: string; draft: FindingDraft; created_at: string }): DocumentFinding {
  const { draft } = input;
  if ((draft.classification === 'observed' || draft.classification === 'conflict') && draft.citations.length === 0) {
    throw new ReasoningError('FACT_REQUIRES_SOURCE_REFERENCE', draft.statement.slice(0, 60));
  }
  if (draft.classification === 'conflict') {
    if (draft.citations.length < 2) throw new ReasoningError('CONFLICT_REQUIRES_TWO_LOCATIONS', draft.statement.slice(0, 60));
    const locations = new Set(draft.citations.map(citation => JSON.stringify([citation.version_id, citation.locator])));
    if (locations.size < 2) throw new ReasoningError('CONFLICT_REQUIRES_TWO_DISTINCT_LOCATIONS', draft.statement.slice(0, 60));
  }
  if (draft.classification === 'suggestion' && draft.material) {
    // A suggestion is what the toolkit would do, not what the sources say. Marking one
    // material would let a proposal enter the requirements without the client agreeing.
    throw new ReasoningError('SUGGESTION_CANNOT_BE_MATERIAL', draft.statement.slice(0, 60));
  }
  return {
    kind: 'document_finding', schema_version: 1, finding_id: `df_${randomUUID()}`,
    job_id: input.job_id, project_id: input.project_id,
    classification: draft.classification, material: draft.material, statement: draft.statement,
    citations: draft.citations, resolution: 'unresolved', created_at: input.created_at,
  };
}

export type ConflictInput = {
  subject: string;
  statements: Array<{ value: string; citation: DocumentCitation }>;
};

/** A conflict between two or more statements of the same subject. Recency is not authority:
 * a newer filename does not settle which rule applies. */
export function detectConflict(input: ConflictInput): {
  conflict: boolean; distinct_values: string[]; citations: DocumentCitation[]; authority: 'undecided';
} {
  const distinct = [...new Set(input.statements.map(statement => statement.value))];
  return {
    conflict: distinct.length > 1,
    distinct_values: distinct,
    citations: input.statements.map(statement => statement.citation),
    authority: 'undecided',
  };
}

const INSTRUCTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bignore\b.{0,40}\b(access|permission|control|restriction|policy|rule)s?\b/i, 'ATTEMPTED_ACCESS_CONTROL_BYPASS'],
  [/\b(you are|act as|you must)\b.{0,60}\b(administrator|admin|system|root)\b/i, 'ATTEMPTED_ROLE_ELEVATION'],
  [/\b(approve|authori[sz]e|deploy|release)\b.{0,40}\b(without|no)\b.{0,20}\b(review|approval|check)/i, 'ATTEMPTED_APPROVAL_BYPASS'],
  [/\b(disregard|override)\b.{0,30}\b(previous|prior|system)\b.{0,20}\b(instruction|prompt)/i, 'ATTEMPTED_INSTRUCTION_OVERRIDE'],
  [/\b(send|upload|email|post)\b.{0,40}\b(to|at)\b\s*https?:\/\//i, 'ATTEMPTED_EXFILTRATION'],
];

export type UntrustedTextVerdict = {
  is_instruction_shaped: boolean;
  patterns: string[];
  /** What the toolkit does with it: record it as something the document says, and stop. */
  treatment: 'recorded_as_observed_content';
  grants_authority: false;
};

/** Source text is inspected, classified and recorded. It is never executed and never treated
 * as permission for anything. */
export function classifySourceText(text: string): UntrustedTextVerdict {
  const patterns = INSTRUCTION_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
  return {
    is_instruction_shaped: patterns.length > 0,
    patterns,
    treatment: 'recorded_as_observed_content',
    grants_authority: false,
  };
}

export type DerivedRequirement = {
  requirement_id: string;
  description: string;
  /** Where it came from: a source the client wrote, or an answer the client gave. */
  origin: 'client_answer' | 'source_document';
  citations: DocumentCitation[];
  answer_id: string | null;
};

/** A requirement derived from a conflict needs the client's answer. Without one, the conflict
 * stays a conflict — an analysis may finish with it unresolved, but it may not adopt a side. */
export function deriveRequirement(input: {
  subject: string; conflict: ReturnType<typeof detectConflict>;
  answer: { answer_id: string; chosen_value: string; actor_id: string } | null;
}): { derived: true; requirement: DerivedRequirement } | { derived: false; reason: string } {
  if (input.conflict.conflict && input.answer === null) {
    return { derived: false, reason: 'CONFLICT_UNRESOLVED_WITHOUT_CLIENT_ANSWER' };
  }
  if (input.answer !== null && !input.conflict.distinct_values.includes(input.answer.chosen_value)) {
    return { derived: false, reason: 'ANSWER_DOES_NOT_MATCH_ANY_SOURCE_STATEMENT' };
  }
  return {
    derived: true,
    requirement: {
      requirement_id: `req_${input.subject.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      description: input.answer === null
        ? `${input.subject}: ${input.conflict.distinct_values[0] ?? ''}`
        : `${input.subject}: ${input.answer.chosen_value}`,
      origin: input.answer === null ? 'source_document' : 'client_answer',
      citations: input.conflict.citations,
      answer_id: input.answer?.answer_id ?? null,
    },
  };
}
