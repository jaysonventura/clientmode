/** Controller-owned browser and API probes.
 *
 * These run outside candidate authority: the browser is launched by the verification side,
 * the results are written to the controller's artifact store, and nothing the candidate
 * writes is read back as a result. A browser that will not start is UNVERIFIED, never an
 * inferred pass.
 */
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';
import type { ArtifactStore } from './artifacts.js';
import { runAxe, observeKeyboard, type AccessibilityObservation, type KeyboardObservation } from './accessibility.js';
import { observeLayout, observeTextScaling, REQUIRED_VIEWPORTS, VIEWPORT_SIMULATION_CAVEAT, type LayoutObservation } from './visual.js';

export type BrowserSession = { browser: Browser; version: string };

export type ProbeFailure = { available: false; reason: 'BROWSER_UNAVAILABLE'; detail: string };

export async function openBrowser(): Promise<BrowserSession | ProbeFailure> {
  try {
    const browser = await chromium.launch({ headless: true });
    return { browser, version: browser.version() };
  } catch (error) {
    return { available: false, reason: 'BROWSER_UNAVAILABLE', detail: String((error as Error).message).slice(0, 400) };
  }
}

export type PageDiagnostics = { console_errors: string[]; page_errors: string[]; failed_requests: string[] };

function watch(page: Page): PageDiagnostics {
  const diagnostics: PageDiagnostics = { console_errors: [], page_errors: [], failed_requests: [] };
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') diagnostics.console_errors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', error => diagnostics.page_errors.push(String(error.message).slice(0, 300)));
  page.on('requestfailed', request => diagnostics.failed_requests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.slice(0, 300)));
  return diagnostics;
}

export type CheckoutJourney = {
  completed: boolean;
  displayed_total: string | null;
  confirmation_text: string | null;
  submit_operable: boolean;
  steps: string[];
  diagnostics: PageDiagnostics;
};

/** Two rice and one soap, then a real form submission, as the qualification brief specifies. */
export async function guestCheckoutJourney(input: {
  session: BrowserSession; baseURL: string; store: ArtifactStore; name: string;
}): Promise<{ journey: CheckoutJourney; layout: LayoutObservation; accessibility: AccessibilityObservation; keyboard: KeyboardObservation }> {
  const context = await input.session.browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const diagnostics = watch(page);
  const steps: string[] = [];
  try {
    await page.goto(input.baseURL, { waitUntil: 'networkidle' });
    steps.push('loaded catalog');
    await page.getByTestId('add-rice').click();
    await page.getByTestId('add-rice').click();
    await page.getByTestId('add-soap').click();
    steps.push('added 2 rice and 1 soap');

    const displayed_total = await page.getByTestId('cart-total').textContent();
    await page.locator('#customer-name').fill('Ana Dela Cruz');
    await page.locator('#customer-mobile').fill('09000000001');
    steps.push('filled customer details');

    const submit = page.locator('#place-order');
    const submit_operable = await submit.isVisible().catch(() => false) && await submit.isEnabled().catch(() => false);
    let confirmation_text: string | null = null;
    if (submit_operable) {
      await submit.click();
      await page.waitForSelector('#confirmation:not([hidden])', { timeout: 10_000 }).catch(() => null);
      confirmation_text = await page.locator('#confirmation').textContent().catch(() => null);
      steps.push('submitted the order');
    } else {
      steps.push('submit control was not operable');
    }

    const layout = await observeLayout({ page, viewport: REQUIRED_VIEWPORTS[1]!, store: input.store, browser_version: input.session.version, name: input.name });
    const accessibility = await runAxe(page);
    // Keyboard operability is observed on a freshly loaded page so the walk starts at the top
    // of the document rather than wherever the journey happened to leave focus.
    const keyboardPage = await context.newPage();
    await keyboardPage.setViewportSize({ width: 390, height: 844 });
    await keyboardPage.goto(input.baseURL, { waitUntil: 'networkidle' });
    const keyboard = await observeKeyboard(keyboardPage, '#place-order');
    await keyboardPage.close();

    return {
      journey: {
        completed: confirmation_text !== null && confirmation_text.includes('received'),
        displayed_total, confirmation_text, submit_operable, steps, diagnostics,
      },
      layout, accessibility, keyboard,
    };
  } finally {
    await context.close();
  }
}

export type ResponsiveObservation = {
  caveat: string;
  layouts: LayoutObservation[];
  text_scaling: Array<{ factor: number; horizontal_overflow: boolean }>;
};

export async function responsiveSweep(input: {
  session: BrowserSession; baseURL: string; store: ArtifactStore; name: string;
}): Promise<ResponsiveObservation> {
  const context = await input.session.browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(input.baseURL, { waitUntil: 'networkidle' });
    const layouts: LayoutObservation[] = [];
    for (const viewport of REQUIRED_VIEWPORTS) {
      layouts.push(await observeLayout({ page, viewport, store: input.store, browser_version: input.session.version, name: input.name }));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const text_scaling = [await observeTextScaling(page, 1.5), await observeTextScaling(page, 2)];
    return { caveat: VIEWPORT_SIMULATION_CAVEAT, layouts, text_scaling };
  } finally {
    await context.close();
  }
}

export type ApiProbe = { name: string; status: number; body: unknown };

/** API journeys run against the same candidate service, outside the browser. */
export async function apiProbes(baseURL: string): Promise<{ probes: ApiProbe[]; order_id: string | null }> {
  const probes: ApiProbe[] = [];
  const call = async (name: string, path: string, init?: RequestInit): Promise<ApiProbe> => {
    const response = await fetch(`${baseURL}${path}`, init);
    const body = await response.json().catch(() => null);
    const probe = { name, status: response.status, body };
    probes.push(probe);
    return probe;
  };
  const json = (body: unknown, key: string): RequestInit => ({
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
  });
  const customer = { name: 'Ana Dela Cruz', mobile: '09000000001' };

  await call('catalog', '/api/products');
  const created = await call('valid_order', '/api/orders', json({ items: [{ product_id: 'rice', quantity: 2 }, { product_id: 'soap', quantity: 1 }], customer }, 'probe-order-1'));
  await call('replayed_order', '/api/orders', json({ items: [{ product_id: 'rice', quantity: 2 }, { product_id: 'soap', quantity: 1 }], customer }, 'probe-order-1'));
  await call('negative_quantity', '/api/orders', json({ items: [{ product_id: 'rice', quantity: -1 }], customer }, 'probe-negative'));
  await call('quantity_above_maximum', '/api/orders', json({ items: [{ product_id: 'rice', quantity: 100 }], customer }, 'probe-max'));
  await call('unknown_product', '/api/orders', json({ items: [{ product_id: 'lechon', quantity: 1 }], customer }, 'probe-unknown'));
  // An attacker-selected price must never reach the total; the server prices the order.
  await call('attacker_price', '/api/orders', json({ items: [{ product_id: 'rice', quantity: 1, unit_price_centavos: 1, price_centavos: 1 }], customer }, 'probe-price'));
  await call('empty_cart', '/api/orders', json({ items: [], customer }, 'probe-empty'));
  await call('bad_mobile', '/api/orders', json({ items: [{ product_id: 'rice', quantity: 1 }], customer: { name: 'Ana', mobile: '12345' } }, 'probe-mobile'));

  const order_id = (created.body as { order?: { order_id?: string } } | null)?.order?.order_id ?? null;
  return { probes, order_id };
}
