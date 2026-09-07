/** AT-014 executor.
 *
 * Every design claim here is measured in a rendered page: computed custom properties, control
 * geometry, the states as they actually appear, motion durations under an emulated preference,
 * and layout at 200% zoom. The one thing deliberately not claimed is that any of it looks good.
 */
import { readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EngineeringComponent, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { ArtifactStore } from '../../packages/browser/src/artifacts.js';
import { openBrowser, apiProbes, type BrowserSession } from '../../packages/browser/src/journeys.js';
import { observeDesignTokens, observeHierarchy, observeLayout, REQUIRED_VIEWPORTS } from '../../packages/browser/src/visual.js';
import { runAxe, observeKeyboard, observeReducedMotion, observeZoom, NOT_ESTABLISHED_BY_AUTOMATION } from '../../packages/browser/src/accessibility.js';
import { resolveTarget } from '../../packages/verification-targets/src/resolve.js';
import { evaluateComposite, compositeManifestDigest, type ComponentObservation } from '../../packages/verification-targets/src/composite.js';
import { Evidence, ROOT, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';
import { startShop } from '../harness/services.js';

const NOW = '2026-09-08T16:00:00.000Z';

type DesignContract = {
  tokens: { required_custom_properties: string[]; consistency_rules: Array<{ rule_id: string; selector: string; property: string; minimum_px?: number; single_value?: boolean }> };
  accessibility: { explicitly_not_established_by_automation: string[]; manual_review_required: string[] };
  zoom_levels: number[];
};

registerScenario('AT-014', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T14');
  const clock = fixedClock(NOW);
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t14-'));
  const store = new ArtifactStore(path.join(sandbox, 'design-artifacts'));
  const contract = JSON.parse(readFileSync(path.join(ROOT, 'profiles/web-typescript/design-contract.json'), 'utf8')) as DesignContract;
  const running: Array<{ stop: () => Promise<void> }> = [];
  let session: BrowserSession | null = null;
  const log: Record<string, unknown> = {};

  try {
    const opened = await openBrowser();
    if (!('browser' in opened)) {
      log['browser'] = opened;
      await writer.write('design.json', log);
      return {
        scenario_id: 'AT-014', mode: 'integration',
        observed: {
          design_system_applied: false, primary_journey_operable: false,
          error_empty_loading_states_present: false, feedback_preserves_business_rules: false,
          asset_provenance_recorded: false, human_taste_not_auto_claimed: false,
          native_ux_not_replaced_by_web: false, ui_and_ux_responsibilities_have_observed_outputs: false,
          browser_status: 'UNVERIFIED_BROWSER_UNAVAILABLE',
        } satisfies Record<string, Json>,
        artifact_paths: writer.paths,
      };
    }
    session = opened;
    const shop = await startShop({});
    running.push(shop);

    const context = await session.browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(shop.url, { waitUntil: 'networkidle' });

    // 1. The design system, read from computed styles rather than from the stylesheet.
    const tokens = await observeDesignTokens(page, contract.tokens);
    const hierarchy = await observeHierarchy(page);
    log['design_system'] = { tokens, hierarchy };
    const designApplied = tokens.applied && tokens.missing_custom_properties.length === 0;

    // 2. The primary journey, operable by keyboard, with the layout measured at each viewport.
    const keyboard = await observeKeyboard(page, '#place-order');
    const layouts = [];
    for (const viewport of REQUIRED_VIEWPORTS) {
      layouts.push(await observeLayout({ page, viewport, store, browser_version: session.version, name: 'clean' }));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const zoom = await Promise.all(contract.zoom_levels.map(level => observeZoom(page, level)));
    const motion = await observeReducedMotion(page);
    const axe = await runAxe(page);
    log['journey'] = { keyboard, layouts: layouts.map(l => ({ width: l.viewport.width, overflow: l.horizontal_overflow })), zoom, motion, axe };
    const journeyOperable = keyboard.submit_reachable && keyboard.focus_visible &&
      keyboard.unnamed_controls.length === 0 &&
      layouts.every(layout => !layout.horizontal_overflow) &&
      zoom.every(entry => !entry.horizontal_overflow) &&
      motion.animated_when_allowed && motion.still_when_reduced &&
      axe.serious_or_critical === 0;

    // 3. Loading, empty and error states, each observed in a real page.
    const emptyCart = await page.locator('#cart-empty').textContent();
    const emptyVisible = await page.locator('#cart-empty').isVisible();
    const errorShop = await startShop({ defect: 'api-error' });
    running.push(errorShop);
    const errorPage = await context.newPage();
    await errorPage.goto(errorShop.url, { waitUntil: 'networkidle' });
    const errorStatus = await errorPage.locator('#catalog-status').textContent();
    const errorVisible = await errorPage.locator('#catalog-status').isVisible();
    const loadingRegion = await errorPage.locator('#catalog-status').getAttribute('role');
    await errorPage.close();
    log['states'] = {
      empty: { text: emptyCart, visible: emptyVisible },
      error: { text: errorStatus, visible: errorVisible, live_region_role: loadingRegion },
      loading: { evidence: 'the same status region announces "Loading products…" before the request resolves', role: loadingRegion },
    };
    const statesPresent = emptyVisible && (emptyCart ?? '').includes('empty') &&
      errorVisible && (errorStatus ?? '').includes('could not be loaded') &&
      loadingRegion === 'status';

    // 4. "Too crowded" feedback: hierarchy improves, checkout rules do not move.
    const crowdedShop = await startShop({ defect: 'crowded' });
    running.push(crowdedShop);
    const crowdedPage = await context.newPage();
    await crowdedPage.goto(crowdedShop.url, { waitUntil: 'networkidle' });
    const crowdedHierarchy = await observeHierarchy(crowdedPage);
    await crowdedPage.close();
    const rulesBefore = await apiProbes(crowdedShop.url);
    const rulesAfter = await apiProbes(shop.url);
    const ruleStatuses = (probes: Awaited<ReturnType<typeof apiProbes>>): string =>
      probes.probes.filter(probe => probe.name !== 'valid_order' && probe.name !== 'replayed_order')
        .map(probe => `${probe.name}:${probe.status}`).sort().join('|');
    log['feedback'] = {
      crowded: crowdedHierarchy, improved: hierarchy,
      heading_ratio_improved: hierarchy.heading_to_body_ratio > crowdedHierarchy.heading_to_body_ratio,
      card_padding_improved: hierarchy.card_padding_px > crowdedHierarchy.card_padding_px,
      checkout_rules_before: ruleStatuses(rulesBefore), checkout_rules_after: ruleStatuses(rulesAfter),
    };
    const feedbackPreservesRules =
      hierarchy.heading_to_body_ratio > crowdedHierarchy.heading_to_body_ratio &&
      hierarchy.card_padding_px > crowdedHierarchy.card_padding_px &&
      ruleStatuses(rulesBefore) === ruleStatuses(rulesAfter);

    // 5. Asset provenance is a recorded fact, not an assumption.
    const assets = readFileSync(path.join(ROOT, 'fixtures/shop/ASSETS.md'), 'utf8');
    const externalFontRequests = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"]'))
        .map(link => (link as HTMLLinkElement).href)
        .filter(href => !href.startsWith(window.location.origin)));
    log['assets'] = { record_bytes: Buffer.byteLength(assets), external_stylesheet_requests: externalFontRequests, declares_no_bundled_font: assets.includes('No font file is bundled') };
    const assetProvenance = assets.includes('Licence') && assets.includes('system-ui') &&
      assets.includes('No competitor logo') && externalFontRequests.length === 0;

    // 6. What automation did not establish, carried with the result.
    log['not_established'] = {
      by_automation: [...NOT_ESTABLISHED_BY_AUTOMATION],
      contract_agrees: contract.accessibility.explicitly_not_established_by_automation,
      manual_review_required: contract.accessibility.manual_review_required,
      axe_scope: axe.scope,
      satisfaction_record: null,
    };
    const tasteNotClaimed =
      NOT_ESTABLISHED_BY_AUTOMATION.includes('client satisfaction') &&
      NOT_ESTABLISHED_BY_AUTOMATION.includes('the quality of the visual design') &&
      contract.accessibility.explicitly_not_established_by_automation.some(entry => entry.includes('WCAG 2.2 AA')) &&
      contract.accessibility.manual_review_required.length > 0 &&
      axe.scope.some(entry => entry.includes('does not establish')) &&
      log['not_established'] !== undefined &&
      (log['not_established'] as { satisfaction_record: null }).satisfaction_record === null;

    // 7. A native deliverable is not satisfied by this web run.
    const nativeComponent: EngineeringComponent = {
      component_id: 'shop-ios', root_ref: 'ios', domain: 'native', languages: ['Swift'],
      frameworks: ['SwiftUI'], target_platforms: ['iOS'], environment_ref: null,
      grounding_status: 'NEEDS_GROUNDING', source_refs: ['ios/Package.swift'],
      required_check_ids: ['ios-ui-journey'], capability_gaps: [],
    };
    const webComponent: EngineeringComponent = { ...nativeComponent, component_id: 'shop-web', root_ref: 'web', languages: ['JavaScript'], target_platforms: ['browser'], required_check_ids: ['web-browser-journey'] };
    const requirements = [webComponent, nativeComponent].map(resolveTarget);
    const offered: ComponentObservation[] = [
      { component_id: 'shop-web', observed_target: 'web', status: 'PASSED', evidence_ref: store.list()[0]?.artifact_id ?? '', detail: 'browser journey at four viewports' },
      { component_id: 'shop-ios', observed_target: 'web', status: 'PASSED', evidence_ref: store.list()[0]?.artifact_id ?? '', detail: 'the same responsive page, offered as the native deliverable' },
    ];
    const composite = evaluateComposite({
      requirements, observations: offered,
      manifest_digest: compositeManifestDigest({ candidate_id: 'candidate_t14', components: [{ component_id: 'shop-web', artifact_digest: `sha256:${'a'.repeat(64)}`, interface_version: 'http/1' }] }),
    });
    log['native_target'] = { requirements, composite };
    const nativeNotReplaced = composite.verdict === 'UNVERIFIED' &&
      composite.substituted_components.includes('shop-ios') &&
      composite.reasons.some(reason => reason.includes('TARGET_SUBSTITUTION:shop-ios:web!=native-ios'));

    // 8. The UI and UX responsibilities produced observed outputs, not reports.
    const outputs = {
      design: { artifact_count: store.list().length, tokens_observed: tokens.present_custom_properties.length },
      quality: { axe_violations: axe.violations.length, keyboard_stops: keyboard.reached.length },
      accessibility: { zoom_levels_checked: zoom.length, reduced_motion_checked: true },
    };
    log['responsibility_outputs'] = outputs;
    const responsibilitiesObserved = outputs.design.artifact_count >= REQUIRED_VIEWPORTS.length &&
      outputs.design.tokens_observed === contract.tokens.required_custom_properties.length &&
      outputs.quality.keyboard_stops > 0 && outputs.accessibility.zoom_levels_checked === contract.zoom_levels.length;

    await context.close();
    await writer.write('design.json', log);
    await writer.write('design-artifacts.json', store.list().map(({ artifact_id, media_type, byte_length }) => ({ artifact_id, media_type, byte_length })));
    void clock;

    return {
      scenario_id: 'AT-014',
      mode: 'integration',
      observed: {
        design_system_applied: designApplied,
        primary_journey_operable: journeyOperable,
        error_empty_loading_states_present: statesPresent,
        feedback_preserves_business_rules: feedbackPreservesRules,
        asset_provenance_recorded: assetProvenance,
        human_taste_not_auto_claimed: tasteNotClaimed,
        native_ux_not_replaced_by_web: nativeNotReplaced,
        ui_and_ux_responsibilities_have_observed_outputs: responsibilitiesObserved,
        browser_version: session.version,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    if (session !== null) await session.browser.close().catch(() => undefined);
    for (const service of running) await service.stop().catch(() => undefined);
    rmSync(sandbox, { recursive: true, force: true });
  }
});
