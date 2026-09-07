/** The unseen holdout.
 *
 * These specs are authored here and nowhere else. Nothing in `skills/`, `adapters/`,
 * `profiles/` or the toolkit's own source may mention a spec id, a brief or a defect class
 * from this file — the gate checks that, because a holdout that leaked into a prompt is not a
 * holdout, it is a rehearsal.
 *
 * The paired-language specs carry the same requirement in English and in Taglish. They are
 * paired so the two can be compared directly: a brief in the client's own mixed language must
 * produce the same requirements as the same brief in English, or the toolkit is asking the
 * client to write in a language that suits the tool.
 */

export const HOLDOUT_CATEGORIES = ['ui', 'auth_data_integration', 'paired_language', 'cross_stack'] as const;
export type HoldoutCategory = (typeof HOLDOUT_CATEGORIES)[number];

export const TARGET_STACKS = ['typescript', 'python', 'swift', 'rust'] as const;
export type TargetStack = (typeof TARGET_STACKS)[number];

/** `boundary` is the interesting one: it passes every check in the protected policy and is
 * only visible to someone reading the change. It is what an independent reviewer is for. */
export type DefectClass = 'none' | 'unit' | 'semantic' | 'boundary';

export type HoldoutSpec = {
  spec_id: string;
  category: HoldoutCategory;
  stack: TargetStack;
  risk_tier: 'low' | 'moderate' | 'high';
  brief_en: string;
  /** Present only for the paired-language category. */
  brief_taglish: string | null;
  defect: DefectClass;
};

const DEFECTS: DefectClass[] = ['none', 'unit', 'semantic', 'boundary'];

function build(): HoldoutSpec[] {
  const specs: HoldoutSpec[] = [];
  const push = (
    spec_id: string, category: HoldoutCategory, stack: TargetStack,
    risk_tier: HoldoutSpec['risk_tier'], brief_en: string, brief_taglish: string | null,
  ): void => {
    specs.push({ spec_id, category, stack, risk_tier, brief_en, brief_taglish, defect: DEFECTS[specs.length % DEFECTS.length]! });
  };

  // 12 UI specs.
  const ui: Array<[string, TargetStack, string]> = [
    ['hx_ui_cart_badge', 'typescript', 'The cart badge should show the number of items, not the number of lines.'],
    ['hx_ui_price_alignment', 'typescript', 'Prices in the order summary should line up on the decimal point.'],
    ['hx_ui_empty_cart', 'typescript', 'An empty cart should say what to do next instead of showing a blank panel.'],
    ['hx_ui_disabled_submit', 'typescript', 'The place-order button should say why it is unavailable, not just be greyed out.'],
    ['hx_ui_error_banner', 'typescript', 'When the order fails, keep what the customer typed and show a way to retry.'],
    ['hx_ui_focus_ring', 'typescript', 'Keyboard focus should be visible on every control in the checkout.'],
    ['hx_ui_small_viewport', 'typescript', 'Nothing should scroll sideways on a 360 pixel wide phone.'],
    ['hx_ui_quantity_stepper', 'typescript', 'The quantity stepper should not let the customer go below one.'],
    ['hx_ui_currency_format', 'typescript', 'Show pesos with two decimals and a thousands separator.'],
    ['hx_ui_loading_state', 'typescript', 'Show a loading state while the order is being placed.'],
    ['hx_ui_long_product_name', 'typescript', 'A very long product name should wrap rather than push the price off the row.'],
    ['hx_ui_receipt_summary', 'typescript', 'The receipt should repeat the total the customer agreed to.'],
  ];
  for (const [id, stack, brief] of ui) push(id, 'ui', stack, 'moderate', brief, null);

  // 12 auth / data / integration specs.
  const auth: Array<[string, TargetStack, HoldoutSpec['risk_tier'], string]> = [
    ['hx_auth_session_scope', 'python', 'high', 'A session should only be able to read its own orders.'],
    ['hx_auth_price_authority', 'python', 'high', 'The server decides the price; the client may not send one.'],
    ['hx_auth_replay_order', 'python', 'high', 'The same order submitted twice should create one order.'],
    ['hx_data_quantity_bounds', 'python', 'moderate', 'Quantities below one must be refused.'],
    ['hx_data_unknown_product', 'python', 'moderate', 'An unknown product id should be refused, not priced as zero.'],
    ['hx_data_total_integrity', 'python', 'high', 'The stored total must match the sum of the priced lines.'],
    ['hx_integration_timeout', 'python', 'moderate', 'A slow payment call should time out rather than hang the request.'],
    ['hx_integration_partial_write', 'python', 'high', 'A failure halfway through must not leave half an order.'],
    ['hx_integration_retry_safety', 'python', 'high', 'Retrying a failed submission must not double-charge.'],
    ['hx_data_currency_units', 'python', 'high', 'Store centavos as integers; never as floating point pesos.'],
    ['hx_auth_role_separation', 'python', 'high', 'A customer may not approve their own refund.'],
    ['hx_data_audit_trail', 'python', 'moderate', 'Every price change should be recorded with who made it.'],
  ];
  for (const [id, stack, risk, brief] of auth) push(id, 'auth_data_integration', stack, risk, brief, null);

  // 12 paired rough-English / Taglish briefs, same requirement in both.
  const paired: Array<[string, TargetStack, string, string]> = [
    ['hx_lang_total_wrong', 'typescript', 'the total is wrong when i add two rice', 'mali yung total pag nag add ako ng dalawang rice'],
    ['hx_lang_no_negative', 'python', 'dont allow minus quantity please', 'wag mong payagan yung minus na quantity ha'],
    ['hx_lang_slow_checkout', 'typescript', 'checkout is slow on my phone', 'ang bagal ng checkout sa phone ko'],
    ['hx_lang_button_hidden', 'typescript', 'i cannot see the order button on mobile', 'di ko makita yung order button sa mobile'],
    ['hx_lang_wrong_change', 'python', 'the change computed is wrong', 'mali yung sukli na nilalabas'],
    ['hx_lang_double_order', 'python', 'it made two orders when i clicked twice', 'dalawa yung order nung dalawang beses ako nag click'],
    ['hx_lang_price_change', 'python', 'price changed after i checked out', 'nagbago yung presyo pagkatapos kong mag checkout'],
    ['hx_lang_receipt_missing', 'typescript', 'no receipt shown after paying', 'walang resibo pagkatapos magbayad'],
    ['hx_lang_login_loop', 'python', 'it keeps asking me to login again', 'paulit ulit akong pinapa-login'],
    ['hx_lang_stock_wrong', 'python', 'it sold something we dont have', 'nabenta yung wala naman kaming stock'],
    ['hx_lang_address_lost', 'typescript', 'my address disappears when there is an error', 'nawawala yung address ko pag may error'],
    ['hx_lang_units_confusing', 'swift', 'the app shows centavos as pesos', 'yung app pinapakita yung centavos na parang pesos'],
  ];
  for (const [id, stack, en, tl] of paired) push(id, 'paired_language', stack, 'moderate', en, tl);

  // 14 cross-stack specs. A JavaScript-only result set is not a broad-remit qualification.
  const cross: Array<[string, TargetStack, HoldoutSpec['risk_tier'], string]> = [
    ['hx_backend_pricing_service', 'python', 'high', 'The pricing service must total an order correctly.'],
    ['hx_backend_rounding', 'python', 'moderate', 'Rounding must never favour the shop.'],
    ['hx_backend_bulk_order', 'python', 'moderate', 'A bulk order of many lines must still price correctly.'],
    ['hx_backend_zero_items', 'python', 'moderate', 'An order with no items must be refused.'],
    ['hx_native_pricing_binary', 'swift', 'high', 'The macOS pricing binary must total an order correctly.'],
    ['hx_native_currency_units', 'swift', 'high', 'The native view must not mix centavos and pesos.'],
    ['hx_native_large_quantity', 'swift', 'moderate', 'A large quantity must not overflow the total.'],
    ['hx_native_refuse_negative', 'swift', 'high', 'The native binary must refuse a negative quantity.'],
    ['hx_systems_parser_bounds', 'rust', 'high', 'The order parser must refuse a quantity below one.'],
    ['hx_systems_parser_total', 'rust', 'high', 'The order parser must total an order correctly.'],
    ['hx_systems_parser_unknown', 'rust', 'moderate', 'The order parser must refuse an unknown product.'],
    ['hx_polyglot_shared_total', 'rust', 'high', 'All three implementations must agree on the same total.'],
    ['hx_llm_grounded_total', 'python', 'moderate', 'An answer about the total must come from the order, not from memory.'],
    ['hx_llm_refuse_unsupported', 'python', 'moderate', 'An answer must be refused when the order does not contain the fact.'],
  ];
  for (const [id, stack, risk, brief] of cross) push(id, 'cross_stack', stack, risk, brief, null);

  return specs;
}

export const HOLDOUT_SPECS: readonly HoldoutSpec[] = build();

/** Distinctive tokens from the holdout: the spec ids and the briefs themselves, verbatim.
 * Single ordinary words are deliberately not used — "submission" appearing in the toolkit's
 * own source is not a leak, and a check that says it is would be noise rather than evidence.
 * A spec id or a whole brief appearing in a prompt, a skill, an adapter or the toolkit's
 * source is a leak, because there is only one place either could have come from. */
export function leakTokens(): string[] {
  return HOLDOUT_SPECS.flatMap(spec =>
    [spec.spec_id, spec.brief_en, ...(spec.brief_taglish === null ? [] : [spec.brief_taglish])]);
}
