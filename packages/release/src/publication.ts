/** What the release is allowed to say about itself.
 *
 * Two documents ship, and they are deliberately separate:
 *
 *   - the **remit**: the kinds of work the AI engineering side will take on;
 *   - the **measured qualification**: the exact versions, platforms and task families that
 *     were actually observed, with the ones that were not.
 *
 * They are separate because they are different claims. A remit that says "any stack" is a
 * statement of willingness. A qualification that says "any stack" is a lie unless every stack
 * was run. This linter reads the published text and refuses any sentence that turns a green
 * fixture into universal mastery.
 */

export type MeasuredScope = {
  /** Stacks, platforms and families actually executed, with the gate that observed them. */
  observed: Array<{ subject: string; evidence_ref: string }>;
  /** Named and explicitly not observed. */
  not_observed: string[];
};

const UNIVERSAL = /\b(any (stack|language|platform|framework|technology)|all (stacks|languages|platforms|frameworks|technologies)|every (stack|language|platform|framework)|universal(ly)?|anything|fully autonomous|no human (review|oversight)|production[- ]ready for everything|works everywhere|guaranteed?)\b/i;
const SUPERLATIVE = /\b(best|fastest|cheapest|world[- ]class|state[- ]of[- ]the[- ]art|industry[- ]leading|unmatched|flawless|zero (bugs|defects))\b/i;
const CERTAINTY = /\b(always works|never fails|100% (accurate|reliable|correct))\b/i;

export type PublicationFinding = {
  document: string;
  line: number;
  text: string;
  rule: 'UNIVERSAL_CLAIM' | 'SUPERLATIVE' | 'CERTAINTY' | 'UNMEASURED_SUBJECT';
};

export type PublicationReview = {
  documents: string[];
  findings: PublicationFinding[];
  publishable: boolean;
};

/** A claim naming a subject is allowed only when that subject appears in the measured scope. */
export function reviewPublication(input: {
  documents: Array<{ name: string; text: string }>;
  measured: MeasuredScope;
  /** Subjects the text may name as claims. Anything named but unmeasured is a finding. */
  claimable_subjects: string[];
}): PublicationReview {
  const findings: PublicationFinding[] = [];
  const observed = new Set(input.measured.observed.map(entry => entry.subject.toLowerCase()));
  for (const document of input.documents) {
    document.text.split('\n').forEach((text, index) => {
      const line = index + 1;
      const add = (rule: PublicationFinding['rule']): void => { findings.push({ document: document.name, line, text: text.trim().slice(0, 200), rule }); };
      // A line that is explicitly stating a limit is not making the claim it names.
      const isLimitStatement = /\b(not (observed|tested|qualified|measured)|no evidence|blocked|out of scope|we do not claim|residual limitation)\b/i.test(text);
      if (isLimitStatement) return;
      if (UNIVERSAL.test(text)) add('UNIVERSAL_CLAIM');
      if (SUPERLATIVE.test(text)) add('SUPERLATIVE');
      if (CERTAINTY.test(text)) add('CERTAINTY');
      for (const subject of input.claimable_subjects) {
        if (!new RegExp(`\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) continue;
        if (observed.has(subject.toLowerCase())) continue;
        // Being listed under "not observed" is not a licence to claim it elsewhere. A line
        // that states the limit is already exempt above; anything else naming an unmeasured
        // subject is making a claim about it.
        add('UNMEASURED_SUBJECT');
      }
    });
  }
  return { documents: input.documents.map(document => document.name), findings, publishable: findings.length === 0 };
}

export type SignoffPath = 'toolkit_qualification' | 'deliverable_technical_readiness' | 'client_acceptance' | 'production_release';

export type Signoff = {
  path: SignoffPath;
  authority: string;
  store: string;
  granted: boolean;
  actor: string;
  reference: string;
};

/** One approval never grants another. This states, for the record, which store each signoff
 * lives in — separation that is asserted rather than shown is not separation. */
export function signoffSeparation(signoffs: readonly Signoff[]): {
  separate: boolean; stores: Record<string, string>; shared_store: string[];
} {
  const stores: Record<string, string> = {};
  for (const signoff of signoffs) stores[signoff.path] = signoff.store;
  const counts = new Map<string, number>();
  for (const store of Object.values(stores)) counts.set(store, (counts.get(store) ?? 0) + 1);
  const shared_store = [...counts.entries()].filter(([, count]) => count > 1).map(([store]) => store);
  return { separate: shared_store.length === 0 && signoffs.length === 4, stores, shared_store };
}
