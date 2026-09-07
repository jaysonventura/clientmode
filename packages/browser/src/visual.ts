/** Rendered-layout observations.
 *
 * A screenshot existing is not a result. What is asserted here is measured in the live
 * document — scroll width against client width, the computed geometry of named controls —
 * and every observation records the exact browser build, viewport and device scale it was
 * taken at, because a layout claim without those is not reproducible.
 */
import type { Page } from 'playwright';
import type { ArtifactStore } from './artifacts.js';

export type Viewport = { width: number; height: number; label: string };

/** The widths the handoff names for delivered web apps. */
export const REQUIRED_VIEWPORTS: Viewport[] = [
  { width: 360, height: 780, label: 'small-phone' },
  { width: 390, height: 844, label: 'phone' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 1440, height: 900, label: 'desktop' },
];

export type LayoutObservation = {
  viewport: Viewport;
  scroll_width: number;
  client_width: number;
  horizontal_overflow: boolean;
  overflowing_selectors: string[];
  screenshot_artifact_id: string;
  browser_version: string;
  device_scale_factor: number;
};

/** Viewport simulation is not device behaviour, and this type says so where it is consumed. */
export const VIEWPORT_SIMULATION_CAVEAT =
  'CSS-pixel viewport simulation in a desktop browser build. Not evidence of iPhone or Android hardware behaviour.';

export async function observeLayout(input: {
  page: Page; viewport: Viewport; store: ArtifactStore; browser_version: string; name: string;
}): Promise<LayoutObservation> {
  const { page, viewport } = input;
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForLoadState('networkidle');

  const measured = await page.evaluate(() => {
    const root = document.documentElement;
    const offenders: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.right > root.clientWidth + 1) {
        const id = element.id ? `#${element.id}` : element.className ? `.${String(element.className).split(' ')[0]}` : element.tagName.toLowerCase();
        if (!offenders.includes(id)) offenders.push(id);
      }
    }
    return {
      scroll_width: root.scrollWidth,
      client_width: root.clientWidth,
      offenders: offenders.slice(0, 10),
    };
  });

  const screenshot = input.store.put(await page.screenshot({ fullPage: true }), 'image/png', `-${input.name}-${viewport.label}.png`);
  const scale = await page.evaluate(() => window.devicePixelRatio);

  return {
    viewport,
    scroll_width: measured.scroll_width,
    client_width: measured.client_width,
    horizontal_overflow: measured.scroll_width > measured.client_width + 1,
    overflowing_selectors: measured.offenders,
    screenshot_artifact_id: screenshot.artifact_id,
    browser_version: input.browser_version,
    device_scale_factor: scale,
  };
}

/** Large-text behaviour, checked by actually changing the root font size. */
export async function observeTextScaling(page: Page, factor: number): Promise<{ factor: number; horizontal_overflow: boolean }> {
  const overflow = await page.evaluate(scale => {
    const root = document.documentElement;
    const original = root.style.fontSize;
    root.style.fontSize = `${16 * scale}px`;
    const overflowed = root.scrollWidth > root.clientWidth + 1;
    root.style.fontSize = original;
    return overflowed;
  }, factor);
  return { factor, horizontal_overflow: overflow };
}

export type DesignTokenObservation = {
  present_custom_properties: string[];
  missing_custom_properties: string[];
  consistency: Array<{ rule_id: string; selector: string; property: string; values: string[]; satisfied: boolean }>;
  applied: boolean;
};

/** The design system is checked where it actually takes effect: the computed styles of the
 * rendered page. A token declared in a stylesheet but overridden everywhere is not applied. */
export async function observeDesignTokens(page: Page, contract: {
  required_custom_properties: string[];
  consistency_rules: Array<{ rule_id: string; selector: string; property: string; minimum_px?: number; single_value?: boolean }>;
}): Promise<DesignTokenObservation> {
  const measured = await page.evaluate(input => {
    const root = window.getComputedStyle(document.documentElement);
    const present: string[] = [];
    const missing: string[] = [];
    for (const name of input.required) {
      (root.getPropertyValue(name).trim() === '' ? missing : present).push(name);
    }
    const consistency = input.rules.map(rule => {
      const values = Array.from(document.querySelectorAll<HTMLElement>(rule.selector))
        .map(element => window.getComputedStyle(element).getPropertyValue(rule.property).trim())
        .filter(value => value !== '');
      return { rule_id: rule.rule_id, selector: rule.selector, property: rule.property, values: [...new Set(values)] };
    });
    return { present, missing, consistency };
  }, { required: contract.required_custom_properties, rules: contract.consistency_rules });

  const consistency = measured.consistency.map(entry => {
    const rule = contract.consistency_rules.find(candidate => candidate.rule_id === entry.rule_id)!;
    const satisfied = entry.values.length > 0 && (
      rule.single_value === true
        ? entry.values.length === 1
        : rule.minimum_px === undefined
          ? true
          : entry.values.every(value => Number.parseFloat(value) >= rule.minimum_px!)
    );
    return { ...entry, satisfied };
  });
  return {
    present_custom_properties: measured.present,
    missing_custom_properties: measured.missing,
    consistency,
    applied: measured.missing.length === 0 && consistency.every(entry => entry.satisfied),
  };
}

/** Visual hierarchy, measured rather than judged: the ratio between a section heading and body
 * text, and the breathing room around the primary action. Improvement is comparative — this
 * says nothing about whether the result is attractive. */
export async function observeHierarchy(page: Page): Promise<{ heading_to_body_ratio: number; primary_action_spacing_px: number; card_padding_px: number }> {
  // No helper function is declared inside the page callback: the bundler that runs this file
  // rewrites named function expressions with a helper that does not exist in the browser, and
  // the page would fail with `__name is not defined`.
  return page.evaluate(() => {
    const body = Number.parseFloat(window.getComputedStyle(document.body).fontSize) || 16;
    const heading = document.querySelector('h2');
    const action = document.querySelector('#place-order');
    const card = document.querySelector('.catalog li');
    const headingSize = heading === null ? 0 : Number.parseFloat(window.getComputedStyle(heading).fontSize) || 0;
    const actionStyle = action === null ? null : window.getComputedStyle(action);
    const actionParent = action === null ? null : window.getComputedStyle(action.parentElement ?? action);
    const cardStyle = card === null ? null : window.getComputedStyle(card);
    return {
      heading_to_body_ratio: headingSize / body,
      primary_action_spacing_px: actionStyle === null || actionParent === null
        ? 0
        : (Number.parseFloat(actionParent.marginBottom) || 0) + (Number.parseFloat(actionStyle.paddingTop) || 0),
      card_padding_px: cardStyle === null ? 0 : Number.parseFloat(cardStyle.paddingTop) || 0,
    };
  });
}
