/** Turning an ordinary request into a requirement contract.
 *
 * Three rules shape everything here:
 *
 *   - An exclusion the client stated is a requirement. "No account" and "no online payment"
 *     are not omissions to be helpfully filled in later; they are approved scope boundaries
 *     and they survive every revision until the client changes them.
 *   - A technical choice is the lead's to make. Framework, database, layout, naming: decided
 *     internally and recorded as a reversible assumption. The client is never asked.
 *   - A question is only asked when the answer changes payment behaviour, data sharing, an
 *     irreversible operation, ownership, material spending, or the promised outcome — and
 *     then exactly one at a time.
 *
 * Rough English and Taglish are ordinary input. Limited English is not limited intelligence,
 * and a brief is never rejected for grammar.
 */
import type { ClientRequest, Requirement } from '../../../contracts/interfaces.js';

export type InterpretationInput = {
  request: ClientRequest;
  /** Facts the controller already holds for this project, with their sources. */
  known_facts?: Array<{ statement: string; source_ref: string }>;
};

export type MaterialQuestion = {
  prompt: string;
  recommendation: string | null;
  reason: 'payment_behaviour' | 'data_sharing' | 'irreversible_operation' | 'ownership_or_authorization' | 'material_spending' | 'promised_outcome';
  blocking_topic: string;
};

export type InternalDecision = { topic: string; decision: string; reversible: true; rationale: string };

export type StackIntent = {
  target: string;
  evidence: string;
  /** What the AI must go and find out, rather than ask the client for. */
  investigation: string[];
};

export type Interpretation = {
  requirements: Requirement[];
  material_questions: MaterialQuestion[];
  internal_decisions: InternalDecision[];
  stack_intents: StackIntent[];
  language_hint: ClientRequest['language_hint'];
};

/** Exclusions, in the words clients actually use, English and Taglish. */
const EXCLUSIONS: Array<[RegExp, string, string]> = [
  [/\b(no|without|walang|wala|hindi kailangan|wag|huwag|ayaw)\b[^.]{0,30}\b(account|sign ?up|register|registration|log ?in)\b/i, 'no-account', 'Customers order without registering or logging in.'],
  [/\b(no|without|walang|wala|hindi|wag|huwag|ayaw)\b[^.]{0,30}\b(online payment|card|credit card|gcash|paypal|checkout payment)\b/i, 'no-online-payment', 'Do not add online payment.'],
  // Few clients write "cash on delivery". They write "pay when it arrives", "bayad pagdating",
  // "COD lang". Missing it means proposing an online payment they told us they do not want.
  [/\bcash on delivery\b|\bcod\b|\bbayad sa pag ?dating\b|\bbayad pag ?dating\b|\bpay (when|on|upon)\b[^.]{0,20}\b(deliver|delivery|arrive|arrives|receive)\b|\bbayad (kapag|pag)\b[^.]{0,20}\b(dating|hatid|deliver)\b/i,
    'cash-on-delivery', 'Payment happens on delivery, outside the software.'],
  [/\b(no|without|walang)\b[^.]{0,30}\b(subscription|recurring)\b/i, 'no-subscription', 'No recurring billing.'],
  // A client saying what must not change is the most expensive thing to miss: work that
  // ignores it has to be undone.
  [/\b(wag|huwag|don'?t|do not|hindi|no|never)\b[^.]{0,40}\b(bag[au]hin|palitan|change|adjust|touch|raise|update)\b[^.]{0,25}\b(presyo|price|prices|pricing|halaga)\b/i,
    'keep-prices', 'Prices stay exactly as they are.'],
  [/\b(walang|wala|no|without)\b[^.]{0,25}\b(delivery fee|shipping fee|bayad sa hatid)\b|\b(delivery fee|shipping fee)\b[^.]{0,25}\b(walang|wala|none|free|libre)\b/i,
    'no-delivery-fee', 'No delivery fee is charged.'],
];

/** Words that turn the phrase after them into the opposite request. */
const NEGATION = /\b(no|not|without|never|wag|huwag|walang|wala|hindi|ayaw)\b/i;

/** A refusal with nothing after it: "ayaw ko sana", "wag na", "pero wag muna", "no thanks".
 *
 * People do not repeat the noun when they reject something they have just named. The refusal
 * lands in its own sentence and refers back, and a reader that only looks inside one sentence
 * misses the most important word in the message. */
const BARE_REJECTION = /^(?:[^a-z0-9]*)(pero\s+)?(ayaw(\s+ko)?(\s+sana)?|wag(\s+na|\s+muna)?|huwag(\s+na|\s+muna)?|hindi\s+na|no\s+thanks?|not\s+(that|those)|skip\s+(it|that))\b/i;

/** What a topic named in one sentence excludes when the next sentence rejects it. */
const REJECTABLE_TOPICS: Array<[RegExp, string, string]> = [
  [/\b(account|sign ?up|register|registration|log ?in)\b/i, 'no-account', 'Customers order without registering or logging in.'],
  [/\b(online payment|card|credit card|gcash|paypal|checkout payment)\b/i, 'no-online-payment', 'Do not add online payment.'],
  [/\b(delivery fee|shipping fee)\b/i, 'no-delivery-fee', 'No delivery fee is charged.'],
  [/\b(subscription|recurring)\b/i, 'no-subscription', 'No recurring billing.'],
];

/** Exclusions the client expressed by naming a thing and then refusing it in the next breath. */
function trailingRejections(message: string): Array<{ id: string; description: string }> {
  const sentences = message.split(/(?<=[.!?])\s+/).filter(part => part.trim() !== '');
  const found: Array<{ id: string; description: string }> = [];
  sentences.forEach((sentence, index) => {
    if (!BARE_REJECTION.test(sentence.trim())) return;
    // Look back for the nearest sentence that named something rejectable.
    for (let back = index - 1; back >= 0 && back >= index - 2; back -= 1) {
      const previous = sentences[back]!;
      const topic = REJECTABLE_TOPICS.find(([pattern]) => pattern.test(previous));
      if (topic === undefined) continue;
      found.push({ id: topic[1], description: topic[2] });
      break;
    }
  });
  return found;
}

/** Clause boundaries. A negation belongs to its own clause: in "No online payment, cash on
 * delivery" the "No" governs the payment, not the delivery. A fixed-width lookback gets this
 * wrong, and gets it wrong differently in English and in Taglish — which would make the same
 * request mean two things depending on which language the client wrote it in. */
const CLAUSE_BOUNDARY = /[.,;!?\n]|\b(then|and|pero|at|tapos)\b/gi;

/** Whether the inclusion matched inside a clause that negates it. "walang delivery fee" is a
 * client saying there is no delivery fee, and reading it as a delivery feature inverts their
 * meaning — which is worse than not reading it at all. */
function negated(message: string, index: number): boolean {
  const before = message.slice(0, index);
  let clauseStart = 0;
  const boundary = new RegExp(CLAUSE_BOUNDARY.source, CLAUSE_BOUNDARY.flags);
  let found: RegExpExecArray | null;
  while ((found = boundary.exec(before)) !== null) clauseStart = found.index + found[0].length;
  return NEGATION.test(before.slice(clauseStart));
}

const INCLUSIONS: Array<[RegExp, string, string]> = [
  // Singular and plural are the same request here too: "two orders" is an ordering brief.
  [/\b(orders?|ordering|mag ?order|bumili|buy)\b/i, 'ordering', 'Customers can place an order.'],
  // A client reporting "the quantity is wrong" is describing the cart, whatever they call it.
  [/\b(cart|basket|quantity|quantities|dami|bilang)\b/i, 'cart', 'Customers can add items to a cart and change quantities.'],
  [/\b(phone|mobile|cellphone|sa phone|android|iphone)\b/i, 'mobile-friendly', 'The experience works on a phone.'],
  // Singular and plural are the same request; grammar never changes the approved scope.
  [/\b(catalog|products?|produkto|items?|menu)\b/i, 'catalog', 'Customers can browse the available products.'],
  [/\b(delivery|deliver|hatid)\b/i, 'delivery', 'Orders are delivered.'],
];

/** Target platforms clients name in passing. Recognising the intent is the point; the
 * technical details behind it are the AI's to investigate, not the client's to supply. */
const STACK_INTENTS: Array<[RegExp, string, string[]]> = [
  [/\b(iphone|ios|app store|native app|swift)\b/i, 'native-ios',
    ['Confirm the deployment target and minimum OS from the project, not from the client.',
     'Establish whether a signing identity and simulator are available; report the gap if not.']],
  [/\b(android|play store|kotlin)\b/i, 'native-android',
    ['Establish the minimum SDK and device availability from the project.',
     'Report an unavailable emulator or device as a capability gap.']],
  [/\b(model|llm|ai service|embedding|rag|inference)\b/i, 'model-service',
    ['Determine the model, dataset and evaluation set from the project and its authorization.',
     'Do not assume an authorized model environment exists; probe it.']],
  [/\b(python|fastapi|django|flask)\b/i, 'python-service',
    ['Read the installed Python version and dependency manifests before proposing changes.']],
  [/\b(java|spring|jvm|maven|gradle)\b/i, 'java-backend',
    ['Read the build file and the installed JDK version before proposing changes.']],
];

/** Topics where an unresolved answer genuinely changes the outcome. Everything else is the
 * lead's decision. */
const MATERIAL_TOPICS: Array<[RegExp, MaterialQuestion['reason'], string, string]> = [
  [/\b(deposit|downpayment|partial payment|installment|hulugan)\b/i, 'payment_behaviour', 'deposit-policy',
    'Should a partial payment be recorded, or is the whole amount always collected on delivery?'],
  [/\b(share|send).{0,20}\b(customer|data|details)\b|\bthird party\b/i, 'data_sharing', 'data-sharing',
    'Should customer details be shared with anyone outside your shop?'],
  [/\b(delete|erase|wipe|reset).{0,20}\b(orders|data|records)\b/i, 'irreversible_operation', 'destructive-operation',
    'Should existing records be deleted, or kept and hidden?'],
  // Money that has not already been settled by the client is asked about once.
  [/\b(presyo|price|prices|pricing|fee|singil|bayad|charge)\b/i, 'payment_behaviour', 'pricing-change',
    'Should any price or fee change as part of this work, or do they all stay exactly as they are now?'],
  // A refund is money leaving the account, which is the client's decision every time.
  [/\b(refund|refunds|refunded|reimburse|sauli|ibalik ang bayad|return the money|chargeback)\b/i,
    'payment_behaviour', 'refund-policy',
    'Refunds move money out. Who should be allowed to issue one, and does it need a second person to approve?'],
];

/** The client asking rather than telling: a question mark, or the words people actually use. */
const INTERROGATIVE = /\?|\b(pwede ba|puwede ba|pwede po ba|dapat ba|kailangan ba|should|could|can we|can you|what if|paano|ano)\b/i;

/** Whether the client raised this topic as a question rather than settling it. */
function asksAbout(message: string, pattern: RegExp): boolean {
  const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let found: RegExpExecArray | null;
  while ((found = matcher.exec(message)) !== null) {
    const start = Math.max(0, message.lastIndexOf('.', found.index) + 1);
    const end = message.indexOf('.', found.index);
    if (INTERROGATIVE.test(message.slice(start, end === -1 ? message.length : end + 1))) return true;
  }
  return false;
}

/** Which stated exclusions settle which material topic, so the client is not asked twice. */
const SETTLED_BY_EXCLUSION: Record<string, string[]> = {
  'pricing-change': ['keep-prices', 'no-delivery-fee'],
  'deposit-policy': ['cash-on-delivery', 'no-online-payment'],
};

/** A technical topic is decided internally and recorded, never asked about. */
const INTERNAL_TOPICS: Array<[RegExp, string, string, string]> = [
  [/\b(database|db|storage|sqlite|postgres)\b/i, 'storage', 'Use a single-file relational store for this scale.', 'Reversible; a migration is cheap at this size.'],
  [/\b(framework|react|vue|stack|language)\b/i, 'framework', 'Use the stack the project already declares.', 'Changing it later is a scoped migration, not a rewrite.'],
  [/\b(color|colour|font|theme|design)\b/i, 'visual-direction', 'Choose one coherent direction and show it in the preview.', 'Feedback on the preview is cheaper than a questionnaire.'],
  [/\b(hosting|deploy|server)\b/i, 'hosting', 'Prepare a local preview; publication is a separate authorization.', 'No hosting decision is needed to build.'],
  [/\b(button|label|wording|caption|text ng|salita)\b/i, 'wording',
    "Use the client's exact wording and show it in the preview.",
    'Wording belongs to the client; the preview is where they check it.'],
  [/\b(cellphone|cellphone ko|phone|mobile|screen|sliding|slide|maliit na screen)\b/i, 'responsive-approach',
    'Fit the existing layout to the smallest supported screen rather than building a separate mobile site.',
    'One layout is cheaper to keep correct than two.'],
];

export function interpret(input: InterpretationInput): Interpretation {
  const message = input.request.message;
  const requirements: Requirement[] = [];
  const source_message_ids = [input.request.request_id];

  for (const [pattern, id, description] of EXCLUSIONS) {
    if (pattern.test(message)) {
      requirements.push({ id, description, source_message_ids, classification: 'excluded', material: true });
    }
  }
  for (const rejection of trailingRejections(message)) {
    if (requirements.some(entry => entry.id === rejection.id)) continue;
    requirements.push({ id: rejection.id, description: rejection.description, source_message_ids, classification: 'excluded', material: true });
  }

  for (const [pattern, id, description] of INCLUSIONS) {
    const matched = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let found: RegExpExecArray | null;
    while ((found = matched.exec(message)) !== null) {
      if (negated(message, found.index)) continue;
      requirements.push({ id, description, source_message_ids, classification: 'required', material: true });
      break;
    }
  }

  const material_questions: MaterialQuestion[] = [];
  for (const [pattern, reason, topic, prompt] of MATERIAL_TOPICS) {
    if (!pattern.test(message)) continue;
    if ((input.known_facts ?? []).some(fact => fact.statement.toLowerCase().includes(topic))) continue;
    // A client who has already said what they want on this topic is not asked again — unless
    // they are the one raising it. "Cash on delivery. Pero pwede ba may deposit?" states a rule
    // and then questions it, and the question is the part that matters.
    const settled = SETTLED_BY_EXCLUSION[topic]?.some(id =>
      requirements.some(entry => entry.id === id && entry.classification === 'excluded')) === true;
    if (settled && !asksAbout(message, pattern)) continue;
    material_questions.push({ prompt, recommendation: null, reason, blocking_topic: topic });
  }

  const internal_decisions: InternalDecision[] = [];
  for (const [pattern, topic, decision, rationale] of INTERNAL_TOPICS) {
    if (pattern.test(message)) internal_decisions.push({ topic, decision, reversible: true, rationale });
  }
  for (const decision of internal_decisions) {
    requirements.push({
      id: `assumption-${decision.topic}`,
      description: `${decision.decision} (${decision.rationale})`,
      source_message_ids, classification: 'assumption', material: false,
    });
  }

  const stack_intents: StackIntent[] = [];
  for (const [pattern, target, investigation] of STACK_INTENTS) {
    const matched = pattern.exec(message);
    if (matched === null) continue;
    stack_intents.push({ target, evidence: matched[0], investigation: [...investigation] });
  }

  return { requirements, material_questions, internal_decisions, stack_intents, language_hint: input.request.language_hint };
}

/** One visible question at a time. The rest are queued, not discarded. */
export function selectVisibleQuestion(questions: MaterialQuestion[]): { visible: MaterialQuestion | null; queued: MaterialQuestion[] } {
  const [visible, ...queued] = questions;
  return { visible: visible ?? null, queued };
}

export class AttachmentError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'AttachmentError';
  }
}

export const TEXT_ATTACHMENT_LIMIT_BYTES = 1_048_576;
export const IMAGE_ATTACHMENT_LIMIT_BYTES = 10 * 1_048_576;
export const MAXIMUM_ATTACHMENTS = 5;

export type IngestedReference = {
  media_type: string;
  byte_length: number;
  /** Rendered inert: markup is escaped, so nothing in the reference can execute or navigate. */
  inert_text: string;
  contains_markup: boolean;
  json_valid?: boolean;
};

function escapeMarkup(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

/** Text references are data. They are decoded strictly, capped, and escaped before anything
 * else looks at them. Nothing in a reference becomes an instruction. */
export function ingestTextReference(input: { media_type: string; bytes: Buffer }): IngestedReference {
  if (!['text/plain', 'text/markdown', 'application/json'].includes(input.media_type)) {
    throw new AttachmentError('UNSUPPORTED_MEDIA_TYPE', input.media_type);
  }
  if (input.bytes.byteLength > TEXT_ATTACHMENT_LIMIT_BYTES) {
    throw new AttachmentError('ATTACHMENT_TOO_LARGE', `${input.bytes.byteLength} bytes`);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text: string;
  try {
    text = decoder.decode(input.bytes);
  } catch {
    throw new AttachmentError('NOT_VALID_UTF8');
  }
  const reference: IngestedReference = {
    media_type: input.media_type,
    byte_length: input.bytes.byteLength,
    inert_text: escapeMarkup(text),
    contains_markup: /<[a-z!/]/i.test(text),
  };
  if (input.media_type === 'application/json') {
    try {
      JSON.parse(text);
      reference.json_valid = true;
    } catch {
      reference.json_valid = false;
    }
  }
  return reference;
}
