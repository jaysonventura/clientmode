/** What clients actually write.
 *
 * Every brief here is the kind of message a small business sends: mixed English and Filipino,
 * no structure, the important constraint buried in the last line. The expectations are declared
 * beside each one, so the corpus measures the reader rather than describing it.
 *
 * `must_include` and `must_exclude` are requirement ids the interpretation has to produce.
 * `must_not_include` is the interesting column: it catches a negated phrase being read as a
 * feature, which is worse than missing it — the client's meaning comes out backwards.
 */
export type Brief = {
  id: string;
  language: 'en' | 'rough_en' | 'mixed';
  message: string;
  must_include: string[];
  must_exclude: string[];
  must_not_include: string[];
  /** Topics the client should be asked about, because money or data or something irreversible. */
  must_ask: string[];
  /** Topics that must be decided rather than asked. */
  must_not_ask: string[];
};

export const BRIEFS: readonly Brief[] = [
  {
    id: 'ordering_basic', language: 'en',
    message: 'I want a simple ordering website for my sari-sari store. Customers browse products, add to cart and check out. No account needed, cash on delivery only.',
    must_include: ['ordering', 'cart', 'catalog'], must_exclude: ['no-account', 'cash-on-delivery'],
    must_not_include: [], must_ask: [], must_not_ask: ['storage', 'framework'],
  },
  {
    id: 'ordering_taglish', language: 'mixed',
    message: 'Gusto ko po ng simpleng ordering website para sa tindahan namin. Pwede mag browse ng produkto, mag add sa cart, tapos mag order. Walang account, cash on delivery lang.',
    must_include: ['ordering', 'cart', 'catalog'], must_exclude: ['no-account', 'cash-on-delivery'],
    must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'keep_prices', language: 'mixed',
    message: 'Ayusin niyo yung checkout page. Wag niyo pong baguhin yung presyo, tama na yun.',
    must_include: [], must_exclude: ['keep-prices'], must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'no_delivery_fee', language: 'mixed',
    message: 'Pakiayos yung ordering. Walang delivery fee for now, libre muna ang hatid.',
    // `delivery` IS a fair reading here: the client delivers, they just do not charge for it.
    // The inversion to guard against is the *fee*, and `no-delivery-fee` is what carries it.
    must_include: ['delivery'], must_exclude: ['no-delivery-fee'], must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'no_online_payment', language: 'rough_en',
    message: 'need order page for my shop. no online payment please, no gcash. customer pay when deliver.',
    must_include: ['ordering'], must_exclude: ['no-online-payment', 'cash-on-delivery'],
    must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'deposit_question', language: 'mixed',
    message: 'Ordering site po, no account, cash on delivery. Pero pwede ba may deposit muna bago i-deliver?',
    must_include: ['ordering'], must_exclude: ['no-account', 'cash-on-delivery'],
    must_not_include: [], must_ask: ['deposit-policy'], must_not_ask: [],
  },
  {
    id: 'delete_records', language: 'en',
    message: 'Can you clean up the system and delete the old orders from last year?',
    must_include: ['ordering'], must_exclude: [], must_not_include: [],
    must_ask: ['destructive-operation'], must_not_ask: [],
  },
  {
    id: 'share_data', language: 'en',
    message: 'We want to send customer details to our delivery partner so they can contact the buyer.',
    must_include: ['delivery'], must_exclude: [], must_not_include: [],
    must_ask: ['data-sharing'], must_not_ask: [],
  },
  {
    id: 'mobile_only', language: 'mixed',
    message: 'Yung site namin ang hirap gamitin sa cellphone, kailangan pa i-slide. Sana kasya sa screen.',
    must_include: ['mobile-friendly'], must_exclude: [], must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'no_subscription', language: 'en',
    message: 'Build the ordering page. No subscription, no recurring billing, we pay once.',
    must_include: ['ordering'], must_exclude: ['no-subscription'], must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'technical_noise', language: 'mixed',
    message: 'Anong database ang gamitin? React ba o Vue? Ano kayang colors? Basta gawin niyo na yung ordering site, walang account.',
    must_include: ['ordering'], must_exclude: ['no-account'], must_not_include: [],
    must_ask: [], must_not_ask: ['storage', 'framework', 'visual-direction'],
  },
  {
    id: 'price_change_open', language: 'mixed',
    message: 'Pwede po bang taasan yung presyo ng rice next month?',
    must_include: [], must_exclude: [], must_not_include: [], must_ask: ['pricing-change'], must_not_ask: [],
  },
  {
    id: 'catalog_only', language: 'en',
    message: 'Just show our products on a page. People will message us on Facebook to buy.',
    must_include: ['catalog'], must_exclude: [], must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'delivery_wanted', language: 'mixed',
    message: 'Kailangan po namin ng delivery tracking, para makita ng customer kung nasaan na yung order.',
    must_include: ['delivery', 'ordering'], must_exclude: [], must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'no_delivery_at_all', language: 'rough_en',
    message: 'ordering page only. no delivery, pickup lang sa store.',
    must_include: ['ordering'], must_exclude: [], must_not_include: ['delivery'], must_ask: [], must_not_ask: [],
  },
  {
    id: 'refund_permission', language: 'en',
    message: 'Staff should be able to refund an order, but only a supervisor can approve it.',
    must_include: ['ordering'], must_exclude: [], must_not_include: [],
    must_ask: ['refund-policy'], must_not_ask: [],
  },
  {
    id: 'quantity_bug', language: 'mixed',
    message: 'May bug po. Kapag ginawa kong zero yung quantity, tinatanggap pa rin. Dapat minimum isa.',
    must_include: ['cart'], must_exclude: [], must_not_include: [], must_ask: [], must_not_ask: [],
  },
  {
    id: 'wording_change', language: 'en',
    message: 'Change the Submit button to say Place order. Nothing else.',
    must_include: ['ordering'], must_exclude: [], must_not_include: [], must_ask: [], must_not_ask: ['wording'],
  },
  {
    id: 'hosting_question', language: 'mixed',
    message: 'Saan po natin ihohost? Basta gawa muna kayo ng ordering page, walang online payment.',
    must_include: ['ordering'], must_exclude: ['no-online-payment'], must_not_include: [],
    must_ask: [], must_not_ask: ['hosting'],
  },
  {
    id: 'multiple_exclusions', language: 'mixed',
    message: 'Ordering site po. Walang account, walang online payment, walang delivery fee, at wag baguhin ang presyo.',
    must_include: ['ordering'],
    must_exclude: ['no-account', 'no-online-payment', 'no-delivery-fee', 'keep-prices'],
    must_not_include: ['delivery'], must_ask: [], must_not_ask: [],
  },
];
