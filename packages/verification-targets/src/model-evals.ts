/** Model and retrieval evaluation.
 *
 * The check is grounding, not fluency: every claim an answer makes must be supported by the
 * source it cites, and a citation that does not contain the claimed fact is a rejection. This
 * runs on a fixed corpus with deterministic scoring, so it observes the answer under test and
 * costs nothing to run. It is not a benchmark of any hosted model.
 */
export type Document = { document_id: string; text: string };

export type Claim = { claim_id: string; statement: string; cited_document_ids: string[]; required_terms: string[] };

export type Answer = { answer_id: string; question: string; claims: Claim[] };

export type ClaimVerdict = {
  claim_id: string;
  grounded: boolean;
  reason: 'SUPPORTED' | 'CITATION_NOT_FOUND' | 'TERMS_ABSENT_FROM_CITATION' | 'NO_CITATION';
  missing_terms: string[];
};

export type EvaluationResult = {
  answer_id: string;
  corpus_revision: string;
  total_claims: number;
  grounded_claims: number;
  verdicts: ClaimVerdict[];
  passed: boolean;
  /** Deterministic scoring over a fixed corpus; not a claim about any model's general ability. */
  scope: string;
};

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

export function evaluateGrounding(input: {
  answer: Answer; corpus: Document[]; corpus_revision: string; minimum_grounded_ratio?: number;
}): EvaluationResult {
  const byId = new Map(input.corpus.map(document => [document.document_id, normalise(document.text)]));
  const verdicts: ClaimVerdict[] = input.answer.claims.map(claim => {
    if (claim.cited_document_ids.length === 0) {
      return { claim_id: claim.claim_id, grounded: false, reason: 'NO_CITATION', missing_terms: claim.required_terms };
    }
    const sources = claim.cited_document_ids.map(id => byId.get(id));
    if (sources.some(source => source === undefined)) {
      return { claim_id: claim.claim_id, grounded: false, reason: 'CITATION_NOT_FOUND', missing_terms: claim.required_terms };
    }
    const haystack = sources.join(' ');
    const missing = claim.required_terms.filter(term => !haystack.includes(normalise(term).trim()));
    return missing.length === 0
      ? { claim_id: claim.claim_id, grounded: true, reason: 'SUPPORTED', missing_terms: [] }
      : { claim_id: claim.claim_id, grounded: false, reason: 'TERMS_ABSENT_FROM_CITATION', missing_terms: missing };
  });

  const grounded = verdicts.filter(verdict => verdict.grounded).length;
  const ratio = verdicts.length === 0 ? 0 : grounded / verdicts.length;
  return {
    answer_id: input.answer.answer_id, corpus_revision: input.corpus_revision,
    total_claims: verdicts.length, grounded_claims: grounded, verdicts,
    passed: verdicts.length > 0 && ratio >= (input.minimum_grounded_ratio ?? 1),
    scope: 'Deterministic grounding check over a fixed synthetic corpus. Not a general model capability claim.',
  };
}

/** Synthetic corpus and answers used by the qualification matrix. */
export const FIXTURE_CORPUS: Document[] = [
  { document_id: 'policy-returns', text: 'Customers may return an unopened item within seven days of delivery. Refunds are issued in cash on collection.' },
  { document_id: 'policy-delivery', text: 'Delivery covers Barangay San Roque only. Orders placed before 3 PM are delivered the same day.' },
  { document_id: 'price-sheet', text: 'Rice 1kg costs 5500 centavos. Bath soap costs 2500 centavos.' },
];

export const GROUNDED_ANSWER: Answer = {
  answer_id: 'answer_grounded',
  question: 'What does two kilos of rice and one soap cost, and when is it delivered?',
  claims: [
    { claim_id: 'price', statement: 'Rice is 5500 centavos and soap is 2500 centavos.', cited_document_ids: ['price-sheet'], required_terms: ['5500', '2500'] },
    { claim_id: 'delivery', statement: 'Orders before 3 PM arrive the same day.', cited_document_ids: ['policy-delivery'], required_terms: ['same day', '3 pm'] },
  ],
};

/** The failure this evaluation exists to catch: a confident answer citing a real document
 * that does not contain the fact. */
export const UNGROUNDED_ANSWER: Answer = {
  answer_id: 'answer_ungrounded',
  question: 'What is the refund window and the delivery fee?',
  claims: [
    { claim_id: 'refund', statement: 'Refunds are available for thirty days.', cited_document_ids: ['policy-returns'], required_terms: ['thirty days'] },
    { claim_id: 'fee', statement: 'Delivery costs 100 centavos.', cited_document_ids: ['policy-delivery'], required_terms: ['100 centavos'] },
  ],
};
