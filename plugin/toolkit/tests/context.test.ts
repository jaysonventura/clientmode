import { describe, expect, it } from 'vitest';
import { buildRouting } from '../src/routing/routing.js';
import { classify } from '../src/routing/classify.js';
import { buildAdditionalContext } from '../src/prompt/run.js';
import type { EnhanceResult } from '../src/prompt/enhance.js';
import { decide } from '../src/prompt/decision.js';
import { cfg, tmpRoot } from './helpers.js';

function fakeResult(root: string, enhancedText: string, prompt = 'add a payment endpoint'): EnhanceResult {
  const c = classify(prompt);
  return {
    routing: buildRouting(prompt, { root, now: '2026-06-17T00:00:00Z' }),
    classification: c,
    decision: decide(prompt, cfg(), c),
    enhancedText,
    enhancedByModel: false,
    backend: 'deterministic',
    reason: 'test',
    degraded: false,
  };
}

describe('additionalContext', () => {
  it('caps length at CDT_MAX_CONTEXT_CHARS', () => {
    const root = tmpRoot();
    const longText = 'x'.repeat(10000);
    const ctx = buildAdditionalContext(fakeResult(root, longText), cfg({ maxContextChars: 500 }));
    expect(ctx.length).toBeLessThanOrEqual(500);
    expect(ctx).toContain('truncated');
  });

  it('redacts secrets in the injected context', () => {
    const root = tmpRoot();
    const ctx = buildAdditionalContext(fakeResult(root, 'use password=hunter2zzz here'), cfg());
    expect(ctx).not.toContain('hunter2zzz');
  });

  // Claude Code best practices: plan when the approach is uncertain or several files change; skip it when
  // the diff fits in a sentence. A skill is read only when it triggers, so the hook says it.
  it('tells T2 and T3 work to enter plan mode before code', () => {
    const root = tmpRoot();
    const ctx = buildAdditionalContext(fakeResult(root, ''), cfg());
    expect(ctx).toMatch(/tier T[23]/);
    expect(ctx).toContain('EnterPlanMode');
  });

  it('leaves T0 and T1 work out of plan mode', () => {
    const root = tmpRoot();
    const ctx = buildAdditionalContext(fakeResult(root, '', 'fix the typo recieve in the README'), cfg());
    expect(ctx).toMatch(/tier T[01]/);
    expect(ctx).not.toContain('EnterPlanMode');
  });
});
