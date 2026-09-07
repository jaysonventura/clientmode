/** AT-006 executor.
 *
 * Real HTTP service with persistence, a real Chromium journey, a real Swift binary compiled
 * and run on this host, a real Python service, and a deterministic grounding evaluation.
 * Injected defects are the public mutation self-tests from docs/QUALIFICATION.md section 3.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EngineeringComponent, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { ArtifactStore } from '../../packages/browser/src/artifacts.js';
import { apiProbes, guestCheckoutJourney, openBrowser, responsiveSweep, type BrowserSession } from '../../packages/browser/src/journeys.js';
import { runAxe, observeKeyboard } from '../../packages/browser/src/accessibility.js';
import { resolveTarget, listIosSimulators, isSubstitution } from '../../packages/verification-targets/src/resolve.js';
import { buildSwiftBinary, interactWithNativeBinary, SWIFT_PRICING_SOURCE, SWIFT_PRICING_DEFECT_SOURCE } from '../../packages/verification-targets/src/native-ui.js';
import { evaluateGrounding, FIXTURE_CORPUS, GROUNDED_ANSWER, UNGROUNDED_ANSWER } from '../../packages/verification-targets/src/model-evals.js';
import { compositeManifestDigest, evaluateComposite, type ComponentObservation } from '../../packages/verification-targets/src/composite.js';
import { ProtectedPolicyStore } from '../../packages/verifier/src/policy.js';
import { execute } from '../../packages/verifier/src/executor.js';
import { Evidence, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';
import { startShop, startPricingService } from '../harness/services.js';

const PYTHON = existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : '/usr/bin/python3';

function component(input: Partial<EngineeringComponent> & { component_id: string; domain: string; target_platforms: string[] }): EngineeringComponent {
  return {
    component_id: input.component_id, root_ref: input.component_id, domain: input.domain,
    languages: input.languages ?? [], frameworks: input.frameworks ?? [],
    target_platforms: input.target_platforms, environment_ref: null,
    grounding_status: 'NEEDS_GROUNDING', source_refs: input.source_refs ?? ['fixtures'],
    required_check_ids: input.required_check_ids ?? ['check.placeholder'], capability_gaps: [],
  };
}

registerScenario('AT-006', async (): Promise<ScenarioObservation> => {
  const evidence = await Evidence.open('T06');
  const clock = fixedClock('2026-09-08T09:00:00.000Z');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t06-'));
  const probeArtifacts = new ArtifactStore(path.join(sandbox, 'probe-artifacts'));
  const candidateWorkspace = path.join(sandbox, 'candidate');
  mkdirSync(candidateWorkspace, { recursive: true });
  const log: Record<string, unknown> = {};
  const running: Array<{ stop: () => Promise<void> }> = [];
  let session: BrowserSession | null = null;

  try {
    // 1. API journey against the real service, with persistence across a restart.
    const databaseFile = path.join(sandbox, 'shop.sqlite');
    const shop = await startShop({ databaseFile });
    running.push(shop);
    const api = await apiProbes(shop.url);
    const created = api.probes.find(probe => probe.name === 'valid_order');
    const replayed = api.probes.find(probe => probe.name === 'replayed_order');
    const total_centavos = (created?.body as { order?: { total_centavos?: number } } | undefined)?.order?.total_centavos ?? -1;
    const attackerPrice = api.probes.find(probe => probe.name === 'attacker_price');
    const attackerTotal = (attackerPrice?.body as { order?: { total_centavos?: number } } | undefined)?.order?.total_centavos ?? -1;

    await shop.stop();
    const restarted = await startShop({ databaseFile });
    running.push(restarted);
    const persisted = await (await fetch(`${restarted.url}/api/orders`)).json() as { orders: Array<{ order_id: string }> };
    const persistedOrder = api.order_id === null ? null
      : await (await fetch(`${restarted.url}/api/orders/${api.order_id}`)).json() as { order?: { total_centavos: number } };

    log['api'] = {
      probes: api.probes.map(probe => ({ name: probe.name, status: probe.status, error: (probe.body as { error?: string } | null)?.error ?? null })),
      total_centavos, attacker_supplied_price_total: attackerTotal,
      replayed_status: replayed?.status, all_persisted_orders: persisted.orders.length,
      orders_for_retried_key: persisted.orders.filter(order => order.order_id === api.order_id).length,
      persisted_order_total: persistedOrder?.order?.total_centavos ?? null,
    };
    // The duplicate submission used one idempotency key, so exactly one order may exist for it.
    // Other probes legitimately create their own orders and are counted separately above.
    const ordersForRetriedKey = persisted.orders.filter(order => order.order_id === api.order_id).length;
    const invalidRejected = ['negative_quantity', 'quantity_above_maximum', 'unknown_product', 'empty_cart', 'bad_mobile']
      .every(name => api.probes.find(probe => probe.name === name)?.status === 422) &&
      attackerTotal === 5500 && persistedOrder?.order?.total_centavos === 13500;

    // 2. Browser journey on the clean candidate.
    const opened = await openBrowser();
    if (!('browser' in opened)) {
      log['browser'] = opened;
      await evidence.write('probes.json', log);
      return {
        scenario_id: 'AT-006', mode: 'integration',
        observed: {
          total_centavos, persisted_orders_after_retry: ordersForRetriedKey,
          invalid_requests_rejected: invalidRejected, guest_checkout_completed: false,
          ui_mutations_detected: false, external_probe_results_not_candidate_writable: false,
          target_native_checks_executed: false, native_and_model_defects_rejected: false,
          browser_status: 'UNVERIFIED_BROWSER_UNAVAILABLE',
        } satisfies Record<string, Json>,
        artifact_paths: evidence.paths,
      };
    }
    session = opened;
    const clean = await guestCheckoutJourney({ session, baseURL: restarted.url, store: probeArtifacts, name: 'clean' });
    const sweep = await responsiveSweep({ session, baseURL: restarted.url, store: probeArtifacts, name: 'clean' });
    log['browser'] = {
      browser_version: session.version,
      journey: { ...clean.journey, diagnostics: clean.journey.diagnostics },
      accessibility: clean.accessibility, keyboard: clean.keyboard,
      responsive: sweep,
    };
    const guestCheckoutCompleted = clean.journey.completed &&
      clean.journey.displayed_total === '₱135.00' &&
      clean.journey.diagnostics.page_errors.length === 0 &&
      clean.journey.diagnostics.console_errors.length === 0 &&
      clean.keyboard.submit_reachable &&
      clean.accessibility.serious_or_critical === 0 &&
      sweep.layouts.every(layout => !layout.horizontal_overflow);

    // 3. Injected UI and API defects must all be caught by the same probes.
    const mutations: Record<string, unknown> = {};
    const overflowShop = await startShop({ defect: 'overflow' });
    running.push(overflowShop);
    const overflowSweep = await responsiveSweep({ session, baseURL: overflowShop.url, store: probeArtifacts, name: 'overflow' });
    const overflowCaught = overflowSweep.layouts.some(layout => layout.viewport.width <= 390 && layout.horizontal_overflow);
    mutations['overflow'] = { caught: overflowCaught, layouts: overflowSweep.layouts.map(l => ({ width: l.viewport.width, scroll_width: l.scroll_width, client_width: l.client_width, overflow: l.horizontal_overflow, offenders: l.overflowing_selectors })) };

    const hiddenShop = await startShop({ defect: 'hidden-submit' });
    running.push(hiddenShop);
    const hidden = await guestCheckoutJourney({ session, baseURL: hiddenShop.url, store: probeArtifacts, name: 'hidden-submit' });
    const hiddenCaught = !hidden.journey.submit_operable && !hidden.journey.completed;
    mutations['hidden_submit'] = { caught: hiddenCaught, submit_operable: hidden.journey.submit_operable, steps: hidden.journey.steps };

    const labelShop = await startShop({ defect: 'missing-label' });
    running.push(labelShop);
    const labelContext = await session.browser.newContext({ viewport: { width: 390, height: 844 } });
    const labelPage = await labelContext.newPage();
    await labelPage.goto(labelShop.url, { waitUntil: 'networkidle' });
    await labelPage.getByTestId('add-rice').click();
    const labelAxe = await runAxe(labelPage);
    const labelKeyboard = await observeKeyboard(labelPage, '#place-order');
    await labelContext.close();
    const labelCaught = labelKeyboard.unnamed_controls.length > 0 ||
      labelAxe.violations.some(violation => /label|name/i.test(violation.id));
    mutations['missing_label'] = { caught: labelCaught, unnamed_controls: labelKeyboard.unnamed_controls, violations: labelAxe.violations.map(v => v.id) };

    const negativeShop = await startShop({ defect: 'negative-quantity' });
    running.push(negativeShop);
    const negativeProbe = await apiProbes(negativeShop.url);
    const negativeStatus = negativeProbe.probes.find(probe => probe.name === 'negative_quantity')?.status;
    const negativeCaught = negativeStatus !== 422;
    mutations['negative_quantity_accepted_by_defective_server'] = { caught: negativeCaught, status: negativeStatus };

    log['ui_mutations'] = mutations;
    const uiMutationsDetected = overflowCaught && hiddenCaught && labelCaught && negativeCaught;

    // 4. A candidate cannot write a probe result. Its own pass.json is ignored, and the
    //    protected sandbox refuses a write into the probe artifact store.
    writeFileSync(path.join(candidateWorkspace, 'pass.json'), JSON.stringify({ status: 'PASS', tests_total: 999, tests_passed: 999 }));
    const store = ProtectedPolicyStore.open(path.join(sandbox, 'verifier-authority'));
    const forgery = await execute({
      argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(path.join(probeArtifacts.root, 'forged.json'))}, '{"status":"PASS"}')`],
      cwd: candidateWorkspace, sandbox_root: path.join(sandbox, 'forge-sandbox'),
      timeout_seconds: 15, maximum_output_bytes: 65536, network_profile_id: 'deny',
      environment: {
        profile_id: 'candidate', required_platform: null, required_executables: ['node'],
        denied_read_paths: [probeArtifacts.root], allowed_write_paths: [candidateWorkspace],
        allow_home_read: false, toolchain_paths: [path.dirname(process.execPath)],
        description: 'Candidate sandbox for the forgery attempt.',
      },
      observer_id: 'probe_t06', now: clock,
    });
    const forged = existsSync(path.join(probeArtifacts.root, 'forged.json'));
    const probeArtifactIds = probeArtifacts.list().map(artifact => artifact.artifact_id);
    log['probe_authority'] = {
      candidate_pass_json_present: existsSync(path.join(candidateWorkspace, 'pass.json')),
      candidate_pass_json_used_as_evidence: false,
      forgery_exit_code: forgery.exit_code, forgery_stderr: forgery.stderr.slice(0, 300),
      forged_file_created: forged,
      probe_artifact_count: probeArtifactIds.length,
      probe_artifact_store: probeArtifacts.root,
    };
    const probeResultsNotCandidateWritable = !forged && forgery.exit_code !== 0 && probeArtifactIds.length > 0;

    // 5. Target-native checks: a compiled Swift binary, a Python service, a grounding
    //    evaluation. Each observed with its own tooling, none substituted by the web run.
    const nativeWorkspace = path.join(sandbox, 'native');
    const goodBuild = buildSwiftBinary({ source: SWIFT_PRICING_SOURCE, workspace: nativeWorkspace, name: 'pricing' });
    const nativeGood = goodBuild.built ? interactWithNativeBinary(goodBuild.binary, ['rice 2 soap 1', 'rice 100']) : null;
    const defectBuild = buildSwiftBinary({ source: SWIFT_PRICING_DEFECT_SOURCE, workspace: nativeWorkspace, name: 'pricing-defect' });
    const nativeDefect = defectBuild.built ? interactWithNativeBinary(defectBuild.binary, ['rice 2 soap 1']) : null;

    const pricingService = await startPricingService(PYTHON);
    running.push(pricingService);
    const serviceResponse = await (await fetch(`${pricingService.url}/price?rice=2&soap=1`)).json() as { total_centavos: number; runtime: string };
    const serviceRejects = await fetch(`${pricingService.url}/price?rice=100`);

    const groundedEval = evaluateGrounding({ answer: GROUNDED_ANSWER, corpus: FIXTURE_CORPUS, corpus_revision: 'fixture-v1' });
    const ungroundedEval = evaluateGrounding({ answer: UNGROUNDED_ANSWER, corpus: FIXTURE_CORPUS, corpus_revision: 'fixture-v1' });

    const simulators = listIosSimulators();
    log['native_and_model'] = {
      swift: goodBuild.built ? { compiler: goodBuild.compiler, target_triple: goodBuild.target_triple } : goodBuild,
      native_good_responses: nativeGood?.responses, native_defect_responses: nativeDefect?.responses,
      python_service: { runtime: serviceResponse.runtime, total_centavos: serviceResponse.total_centavos, rejects_over_maximum: serviceRejects.status },
      grounded_eval: groundedEval, ungrounded_eval: ungroundedEval,
      ios_simulators_available: simulators.length, ios_example: simulators[0]?.name ?? null,
    };
    const nativeExecuted = goodBuild.built && nativeGood !== null &&
      nativeGood.responses.includes('TOTAL 13500') && nativeGood.responses.includes('ERROR invalid_item') &&
      serviceResponse.total_centavos === 13500 && serviceResponse.runtime.startsWith('python') &&
      serviceRejects.status === 422 && groundedEval.passed;
    const defectsRejected = nativeDefect !== null && !nativeDefect.responses.includes('TOTAL 13500') &&
      !ungroundedEval.passed &&
      ungroundedEval.verdicts.every(verdict => !verdict.grounded);

    // 6. Composite readiness across the four components.
    const components: EngineeringComponent[] = [
      component({ component_id: 'shop-web', domain: 'web', languages: ['JavaScript'], target_platforms: ['browser'] }),
      component({ component_id: 'pricing-native', domain: 'native', languages: ['Swift'], target_platforms: ['macOS'] }),
      component({ component_id: 'pricing-service', domain: 'backend', languages: ['Python'], target_platforms: ['server'] }),
      component({ component_id: 'retrieval-model', domain: 'llm-rag', languages: ['Python'], target_platforms: ['model-serving-target'] }),
      component({ component_id: 'shop-ios', domain: 'native', languages: ['Swift'], target_platforms: ['iOS'] }),
    ];
    const requirements = components.map(resolveTarget);
    const manifest_digest = compositeManifestDigest({
      candidate_id: 'candidate_t06',
      components: [
        { component_id: 'shop-web', artifact_digest: probeArtifactIds[0] ?? 'sha256:0', interface_version: 'http/1' },
        { component_id: 'pricing-native', artifact_digest: goodBuild.built ? 'sha256:swift' : 'sha256:none', interface_version: 'stdio/1' },
        { component_id: 'pricing-service', artifact_digest: 'sha256:python', interface_version: 'http/1' },
        { component_id: 'retrieval-model', artifact_digest: 'sha256:corpus-fixture-v1', interface_version: 'eval/1' },
      ],
    });
    const observations: ComponentObservation[] = [
      { component_id: 'shop-web', observed_target: 'web', status: guestCheckoutCompleted ? 'PASSED' : 'FAILED', evidence_ref: probeArtifactIds[0] ?? '', detail: 'browser journey' },
      { component_id: 'pricing-native', observed_target: 'native-macos', status: nativeExecuted ? 'PASSED' : 'FAILED', evidence_ref: 'swift-binary', detail: 'compiled and interacted' },
      { component_id: 'pricing-service', observed_target: 'service', status: 'PASSED', evidence_ref: 'python-service', detail: 'live requests' },
      { component_id: 'retrieval-model', observed_target: 'model', status: groundedEval.passed ? 'PASSED' : 'FAILED', evidence_ref: 'grounding-eval', detail: 'grounding evaluation' },
      // The iOS component is deliberately offered a web observation. It must be refused.
      { component_id: 'shop-ios', observed_target: 'web', status: 'PASSED', evidence_ref: probeArtifactIds[0] ?? '', detail: 'browser run offered for a native target' },
    ];
    const composite = evaluateComposite({ requirements, observations, manifest_digest });
    const substitutionRefused = composite.substituted_components.includes('shop-ios') &&
      isSubstitution(requirements.find(requirement => requirement.component_id === 'shop-ios')!, 'web');
    log['composite'] = { requirements, composite, substitution_refused: substitutionRefused };

    store.close();
    await evidence.write('probes.json', log);
    await evidence.write('api-probes.json', api.probes);
    await evidence.write('probe-artifacts.json', probeArtifacts.list().map(({ artifact_id, media_type, byte_length }) => ({ artifact_id, media_type, byte_length })));

    return {
      scenario_id: 'AT-006',
      mode: 'integration',
      observed: {
        total_centavos,
        persisted_orders_after_retry: ordersForRetriedKey,
        invalid_requests_rejected: invalidRejected,
        guest_checkout_completed: guestCheckoutCompleted,
        ui_mutations_detected: uiMutationsDetected,
        external_probe_results_not_candidate_writable: probeResultsNotCandidateWritable,
        target_native_checks_executed: nativeExecuted,
        native_and_model_defects_rejected: defectsRejected,
        composite_verdict: composite.verdict,
        web_substitution_for_native_refused: substitutionRefused,
        browser_version: session.version,
        host_platform: os.platform(),
      } satisfies Record<string, Json>,
      artifact_paths: evidence.paths,
    };
  } finally {
    if (session !== null) await session.browser.close().catch(() => undefined);
    for (const service of running) await service.stop().catch(() => undefined);
    rmSync(sandbox, { recursive: true, force: true });
  }
});
