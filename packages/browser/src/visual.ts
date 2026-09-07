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
