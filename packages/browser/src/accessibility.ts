/** Accessibility observations.
 *
 * axe-core finds a real subset of WCAG problems. It does not establish conformance, and this
 * module reports its scope alongside its findings so a green automated run is never read as
 * "accessible". Keyboard operability is checked by actually pressing Tab and reading the
 * focused element, not by inspecting markup.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';

const require = createRequire(import.meta.url);

export type AxeViolation = { id: string; impact: string | null; help: string; nodes: number; targets: string[] };

export type AccessibilityObservation = {
  tool: string;
  tool_version: string;
  violations: AxeViolation[];
  serious_or_critical: number;
  /** What this run does and does not establish. */
  scope: string[];
};

export const AUTOMATED_SCOPE = [
  'Automated rule subset only; it does not establish WCAG 2.2 AA conformance.',
  'Manual keyboard and assistive-technology review of key flows is still required.',
];

export async function runAxe(page: Page, context?: string): Promise<AccessibilityObservation> {
  const axePath = require.resolve('axe-core/axe.min.js');
  const version = (require('axe-core/package.json') as { version: string }).version;
  await page.addScriptTag({ content: readFileSync(axePath, 'utf8') });
  const raw = await page.evaluate(async selector => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: Array<Record<string, unknown>> }> } }).axe;
    const result = await axe.run(selector ?? document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.map(violation => ({
      id: String(violation['id']),
      impact: violation['impact'] === null || violation['impact'] === undefined ? null : String(violation['impact']),
      help: String(violation['help']),
      nodes: Array.isArray(violation['nodes']) ? violation['nodes'].length : 0,
      targets: (Array.isArray(violation['nodes']) ? violation['nodes'] : [])
        .flatMap(node => (node as { target?: string[] }).target ?? []).slice(0, 5),
    }));
  }, context ?? null);

  return {
    tool: 'axe-core', tool_version: version, violations: raw,
    serious_or_critical: raw.filter(violation => violation.impact === 'serious' || violation.impact === 'critical').length,
    scope: AUTOMATED_SCOPE,
  };
}

export type KeyboardObservation = {
  reached: string[];
  submit_reachable: boolean;
  focus_visible: boolean;
  /** Controls with no accessible name, found by reading the computed name in the page. */
  unnamed_controls: string[];
};

/** Walk the page with real Tab presses and read what actually receives focus. */
export async function observeKeyboard(page: Page, submitSelector: string, maximumStops = 40): Promise<KeyboardObservation> {
  const reached: string[] = [];
  let submit_reachable = false;
  let emptyStops = 0;
  for (let stop = 0; stop < maximumStops; stop += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return null;
      return {
        tag: active.tagName.toLowerCase(),
        id: active.id,
        testid: active.dataset['testid'] ?? '',
        text: (active.textContent ?? '').trim().slice(0, 40),
      };
    });
    // Tab can land on the document body once while the sequential navigation point settles;
    // two in a row means the walk has genuinely left the page.
    if (focused === null) {
      emptyStops += 1;
      if (emptyStops >= 2) break;
      continue;
    }
    emptyStops = 0;
    const label = focused.id !== '' ? `#${focused.id}` : focused.testid !== '' ? `[${focused.testid}]` : `${focused.tag}:${focused.text}`;
    if (reached.includes(label)) break;
    reached.push(label);
    if (focused.id === submitSelector.replace('#', '')) submit_reachable = true;
  }

  const unnamed = await page.evaluate(() => {
    const problems: string[] = [];
    for (const control of Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea, button'))) {
      const explicit = control.getAttribute('aria-label') ?? '';
      const labelled = control.getAttribute('aria-labelledby');
      const associated = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
      const inner = control.tagName === 'BUTTON' ? (control.textContent ?? '').trim() : '';
      const named = explicit.trim() !== '' || labelled !== null || associated !== null || inner !== '';
      if (!named) problems.push(control.id !== '' ? `#${control.id}` : control.tagName.toLowerCase());
    }
    return problems;
  });

  const focus_visible = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const style = window.getComputedStyle(active);
    return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
  });

  return { reached, submit_reachable, focus_visible, unnamed_controls: unnamed };
}
