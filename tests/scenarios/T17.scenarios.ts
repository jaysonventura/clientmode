/** AT-017 executor — live_provider.
 *
 * Both distributions are built from the one source tree, installed under a path containing a
 * space and a non-ASCII character, alongside configuration that was already there. Fresh
 * sessions of both installed hosts load the installed package, and uninstall is compared
 * against a byte fingerprint taken before anything was written.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { buildDistribution, validateManifest, PackagingError } from '../../packages/packaging/src/build.js';
import { fingerprintTree } from '../../packages/packaging/src/install.js';
import { install, remove, describePlan } from '../../apps/cli/src/install.js';
import { Evidence, ROOT, attempt } from '../harness/evidence.js';
import { disposableProject, liveHostAvailable, liveTurn } from '../harness/live-provider.js';
import { registerScenario } from '../harness/registry.js';

const NOW = '2026-09-08T19:00:00.000Z';
const MARKER = 'CLIENT_MODE_INSTRUCTIONS_LOADED';
/** A space and a non-ASCII character, because installed paths have both in real life. */
const AWKWARD_DIRECTORY = 'Client Mode Tëst Config';

registerScenario('AT-017', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T17');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t17-'));
  const installRoot = path.join(sandbox, AWKWARD_DIRECTORY);
  const outRoot = path.join(sandbox, 'dist');
  const projects: string[] = [];
  const log: Record<string, unknown> = {};

  try {
    // Configuration that was already on this machine, owned by someone else.
    mkdirSync(installRoot, { recursive: true });
    const existingSettings = { theme: 'dark', permissions: { allow: ['Bash(git status)'] }, statusLine: { type: 'command', command: 'my-status' } };
    writeFileSync(path.join(installRoot, 'settings.json'), JSON.stringify(existingSettings, null, 2) + '\n');
    mkdirSync(path.join(installRoot, 'agents'), { recursive: true });
    writeFileSync(path.join(installRoot, 'agents', 'my-reviewer.md'), '# my own agent\nUnrelated to Client Mode.\n');
    const before = fingerprintTree(installRoot);

    // 1. Two self-contained distributions from one source tree.
    const claude = buildDistribution({ provider: 'claude', source_root: ROOT, out_root: outRoot, version: '0.1.0' });
    const codex = buildDistribution({ provider: 'codex', source_root: ROOT, out_root: outRoot, version: '0.1.0' });
    const skillCount = readdirSync(path.join(ROOT, 'skills')).length;
    log['distributions'] = [claude, codex].map(distribution => ({
      provider: distribution.provider, digest: distribution.distribution_digest,
      file_count: distribution.files.length, self_contained: distribution.self_contained,
      external_references: distribution.external_references,
      skills: distribution.files.filter(file => file.path.startsWith('skills/')).length,
    }));
    const selfContained = claude.self_contained && codex.self_contained &&
      claude.distribution_digest !== codex.distribution_digest &&
      claude.files.filter(file => file.path.endsWith('SKILL.md')).length === skillCount &&
      codex.files.filter(file => file.path.endsWith('SKILL.md')).length === skillCount;

    // 2. Native manifests validated, and a broken one refused.
    const claudeManifest = validateManifest('claude', claude.manifest_path, claude.root);
    const codexManifest = validateManifest('codex', codex.manifest_path, codex.root);
    const brokenRoot = path.join(sandbox, 'broken');
    mkdirSync(brokenRoot, { recursive: true });
    writeFileSync(path.join(brokenRoot, 'client-mode.json'), '{ this is not json');
    const brokenManifest = attempt(() => validateManifest('codex', path.join(brokenRoot, 'client-mode.json'), brokenRoot));
    const missingReference = attempt(() => {
      writeFileSync(path.join(brokenRoot, 'client-mode.json'), JSON.stringify({ name: 'x', version: '1', instructions_file: 'AGENTS.md', skills: ['skills/nope/SKILL.md'] }));
      return validateManifest('codex', path.join(brokenRoot, 'client-mode.json'), brokenRoot);
    });
    const wrongLocation = attempt(() => validateManifest('claude', path.join(codex.root, 'client-mode.json'), codex.root));
    const skillWithoutFrontMatter = attempt(() => {
      const broken = path.join(sandbox, 'broken-source');
      mkdirSync(path.join(broken, 'skills', 'nameless'), { recursive: true });
      writeFileSync(path.join(broken, 'skills', 'nameless', 'SKILL.md'), '# no front matter\n');
      mkdirSync(path.join(broken, 'adapters', 'codex'), { recursive: true });
      writeFileSync(path.join(broken, 'adapters', 'codex', 'AGENTS.md'), 'x\n');
      return buildDistribution({ provider: 'codex', source_root: broken, out_root: path.join(sandbox, 'dist-broken'), version: '0.0.1' });
    });
    log['manifests'] = {
      claude: claudeManifest, codex: codexManifest,
      unparseable: brokenManifest, missing_reference: missingReference,
      wrong_location: wrongLocation, skill_without_front_matter: skillWithoutFrontMatter,
    };
    const manifestsValidated = claudeManifest['name'] === 'client-mode' && codexManifest['name'] === 'client-mode' &&
      !brokenManifest.ok && !missingReference.ok && !wrongLocation.ok && !skillWithoutFrontMatter.ok &&
      PackagingError.name === 'PackagingError';

    // 3. Dry run first. Nothing is written until the plan is approved.
    const dryRun = install({
      provider: 'claude', source_root: ROOT, out_root: outRoot,
      install_root: installRoot, version: '0.1.0', dry_run: true, now: NOW,
    });
    const afterDryRun = fingerprintTree(installRoot);
    const applied = install({
      provider: 'claude', source_root: ROOT, out_root: outRoot,
      install_root: installRoot, version: '0.1.0', dry_run: false, now: NOW,
    });
    const settingsAfter = JSON.parse(readFileSync(path.join(installRoot, 'settings.json'), 'utf8')) as Record<string, unknown>;
    log['install'] = {
      dry_run_plan: describePlan(dryRun.plan),
      tree_unchanged_by_dry_run: JSON.stringify(before) === JSON.stringify(afterDryRun),
      applied_files: applied.applied?.created.length ?? 0,
      settings_after: settingsAfter,
      install_root_contains_space_and_non_ascii: installRoot.includes(' ') && /[^\x20-\x7e]/.test(installRoot),
    };
    const unrelatedPreserved = JSON.stringify(before) === JSON.stringify(afterDryRun) &&
      settingsAfter['theme'] === 'dark' &&
      JSON.stringify(settingsAfter['permissions']) === JSON.stringify(existingSettings.permissions) &&
      JSON.stringify(settingsAfter['statusLine']) === JSON.stringify(existingSettings.statusLine) &&
      readFileSync(path.join(installRoot, 'agents', 'my-reviewer.md'), 'utf8').includes('my own agent');

    // 4. Fresh sessions of both installed hosts load the installed package.
    const claudeAvailable = await liveHostAvailable('claude');
    const codexAvailable = await liveHostAvailable('codex');
    const sessions: Record<string, unknown> = {};
    let bothLoaded = false;
    if (claudeAvailable.available && codexAvailable.available) {
      const installedClaude = path.join(installRoot, 'client-mode', 'CLAUDE.md');
      const claudeProject = disposableProject({ file: 'CLAUDE.md', body: readFileSync(installedClaude, 'utf8') });
      projects.push(claudeProject);
      const claudeTurn = await liveTurn({
        executable: 'claude', cwd: claudeProject,
        argv: ['-p', 'Reply with the delivery marker from your instructions and nothing else.',
          '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan'],
      });

      const codexInstall = install({
        provider: 'codex', source_root: ROOT, out_root: outRoot,
        install_root: path.join(sandbox, 'codex-config'), version: '0.1.0', dry_run: false, now: NOW,
      });
      const installedCodex = path.join(sandbox, 'codex-config', 'client-mode', 'AGENTS.md');
      const codexProject = disposableProject({ file: 'AGENTS.md', body: readFileSync(installedCodex, 'utf8') });
      projects.push(codexProject);
      const codexTurn = await liveTurn({
        executable: 'codex', cwd: codexProject,
        argv: ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check',
          'Reply with the delivery marker from your instructions and nothing else.'],
      });
      const claudeLoaded = claudeTurn.stdout.includes(MARKER);
      const codexLoaded = codexTurn.stdout.includes(MARKER);
      sessions['claude'] = { exit_code: claudeTurn.exit_code, marker_returned: claudeLoaded, source: installedClaude };
      sessions['codex'] = { exit_code: codexTurn.exit_code, marker_returned: codexLoaded, source: installedCodex, installed_files: codexInstall.applied?.created.length ?? 0 };
      bothLoaded = claudeLoaded && codexLoaded;
    } else {
      sessions['blocked'] = { claude: claudeAvailable, codex: codexAvailable };
    }
    log['fresh_sessions'] = sessions;

    // 5. Uninstall restores what we changed and leaves everything else alone.
    const removal = remove(applied.applied!);
    const afterUninstall = fingerprintTree(installRoot);
    const settingsRestored = JSON.parse(readFileSync(path.join(installRoot, 'settings.json'), 'utf8')) as Record<string, unknown>;
    log['uninstall'] = {
      removed: removal.removed.length, restored: removal.restored.length,
      left_alone_keys: removal.left_alone,
      settings_after_uninstall: settingsRestored,
      tree_matches_original: JSON.stringify(before) === JSON.stringify(afterUninstall),
      client_mode_directory_present: readdirSync(installRoot).includes('client-mode'),
    };
    const uninstallRestores = JSON.stringify(before) === JSON.stringify(afterUninstall) &&
      settingsRestored['clientMode'] === undefined &&
      settingsRestored['theme'] === 'dark' &&
      !readdirSync(installRoot).includes('client-mode');

    await writer.write('packaging.json', log);
    await writer.write('distribution-files.json', { claude: claude.files, codex: codex.files });

    return {
      scenario_id: 'AT-017',
      mode: 'live_provider',
      observed: {
        both_distributions_self_contained: selfContained,
        native_formats_validated: manifestsValidated,
        fresh_sessions_load_both: bothLoaded,
        unrelated_configuration_preserved: unrelatedPreserved,
        uninstall_restores_owned_changes: uninstallRestores,
        skills_packaged: skillCount,
        install_root: installRoot,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    for (const project of projects) rmSync(project, { recursive: true, force: true });
    rmSync(sandbox, { recursive: true, force: true });
  }
});
