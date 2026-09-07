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
  [/\b(no|without|walang|wala|hindi kailangan)\b[^.]{0,30}\b(account|sign ?up|register|registration|log ?in)\b/i, 'no-account', 'Customers order without registering or logging in.'],
  [/\b(no|without|walang|wala|hindi)\b[^.]{0,30}\b(online payment|card|credit card|gcash|paypal|checkout payment)\b/i, 'no-online-payment', 'Do not add online payment.'],
  [/\bcash on delivery\b|\bcod\b|\bbayad sa pag ?dating\b/i, 'cash-on-delivery', 'Payment happens on delivery, outside the software.'],
  [/\b(no|without|walang)\b[^.]{0,30}\b(subscription|recurring)\b/i, 'no-subscription', 'No recurring billing.'],
];

const INCLUSIONS: Array<[RegExp, string, string]> = [
  // Singular and plural are the same request here too: "two orders" is an ordering brief.
  [/\b(orders?|ordering|mag ?order|bumili|buy)\b/i, 'ordering', 'Customers can place an order.'],
  [/\b(cart|basket)\b/i, 'cart', 'Customers can add items to a cart and change quantities.'],
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
];

/** A technical topic is decided internally and recorded, never asked about. */
const INTERNAL_TOPICS: Array<[RegExp, string, string, string]> = [
  [/\b(database|db|storage|sqlite|postgres)\b/i, 'storage', 'Use a single-file relational store for this scale.', 'Reversible; a migration is cheap at this size.'],
  [/\b(framework|react|vue|stack|language)\b/i, 'framework', 'Use the stack the project already declares.', 'Changing it later is a scoped migration, not a rewrite.'],
  [/\b(color|colour|font|theme|design)\b/i, 'visual-direction', 'Choose one coherent direction and show it in the preview.', 'Feedback on the preview is cheaper than a questionnaire.'],
  [/\b(hosting|deploy|server)\b/i, 'hosting', 'Prepare a local preview; publication is a separate authorization.', 'No hosting decision is needed to build.'],
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
  for (const [pattern, id, description] of INCLUSIONS) {
    if (pattern.test(message)) {
      requirements.push({ id, description, source_message_ids, classification: 'required', material: true });
    }
  }

  const material_questions: MaterialQuestion[] = [];
  for (const [pattern, reason, topic, prompt] of MATERIAL_TOPICS) {
    if (!pattern.test(message)) continue;
    if ((input.known_facts ?? []).some(fact => fact.statement.toLowerCase().includes(topic))) continue;
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
