/** `cm install` — build, show the diff, ask, then apply.
 *
 * The command never applies anything the operator has not seen. `--dry-run` prints the plan
 * and exits; without approval, applying is refused by the packaging layer itself, so a wrapper
 * that forgets to ask cannot install behind the operator's back.
 */
import { buildDistribution, type ProviderTarget } from '../../../packages/packaging/src/build.js';
import { applyInstall, approve, planInstall, uninstall, type InstallPlan, type InstallRecord } from '../../../packages/packaging/src/install.js';

export type InstallOutcome = {
  provider: ProviderTarget;
  distribution_digest: string;
  self_contained: boolean;
  plan: InstallPlan;
  applied: InstallRecord | null;
  summary: string[];
};

export function describePlan(plan: InstallPlan): string[] {
  return plan.changes.map(change =>
    change.action === 'merge'
      ? `merge  ${change.target} (adds ${change.adds_keys.join(', ')}; preserves ${change.preserves_keys.length} existing key(s))`
      : `${change.action.padEnd(6)} ${change.target}`);
}

export function install(input: {
  provider: ProviderTarget; source_root: string; out_root: string; install_root: string;
  version: string; dry_run: boolean; now: string;
}): InstallOutcome {
  const distribution = buildDistribution({
    provider: input.provider, source_root: input.source_root,
    out_root: input.out_root, version: input.version,
  });
  const plan = planInstall({ distribution, install_root: input.install_root });
  const summary = describePlan(plan);
  if (input.dry_run) {
    return { provider: input.provider, distribution_digest: distribution.distribution_digest, self_contained: distribution.self_contained, plan, applied: null, summary };
  }
  const applied = applyInstall({ plan: approve(plan), distribution, now: input.now });
  return { provider: input.provider, distribution_digest: distribution.distribution_digest, self_contained: distribution.self_contained, plan, applied, summary };
}

export function remove(record: InstallRecord): ReturnType<typeof uninstall> {
  return uninstall(record);
}
