/** AT-003 executor. Real Git checkout, real symlink escape, real polyglot fixtures. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientRequest, Contract, Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { onboard, readGitState } from '../../packages/workspace/src/onboard.js';
import { inventoryStack, toEngineeringContext } from '../../packages/workspace/src/stack-inventory.js';
import { snapshot, selectEntries, buildManifest, type SourceManifest } from '../../packages/workspace/src/snapshot.js';
import { claimWriteScope } from '../../packages/workspace/src/ownership.js';
import { checkIntegration, sealCandidate, type ArtifactBuilder } from '../../packages/workspace/src/integrate.js';
import { disposeWorkspace } from '../../packages/workspace/src/cleanup.js';
import { Evidence, ROOT, attempt, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t03';
/** A directory name with a space and a non-ASCII character, built from escapes so the
 * fixture is unambiguous in review and in any terminal that renders this file. */
const UNICODE_DIR = 'menu ñ';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-C', cwd, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', ...args],
    { stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(root: string, relative: string, body: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

/** Independent tree hash used only to prove onboarding changed nothing. */
function treeFingerprint(root: string): string {
  const hash = createHash('sha256');
  for (const entry of selectEntries(root, { excludedDirectories: ['.git'] }).sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(`${entry.path} ${entry.kind} ${entry.content_digest} ${entry.executable}\n`);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** A real deterministic build: the artifact is derived from the sealed source bytes and
 * written outside the workspace, so sealing never mutates the checkout it describes. */
function makeBuilder(outputRoot: string): ArtifactBuilder {
  return {
    builder_id: 'fixture-local-builder@1',
    build({ source }: { workspace_root: string; source: SourceManifest }) {
      const payload = JSON.stringify({
        builder: 'fixture-local-builder@1',
        inputs: source.entries.filter(entry => entry.kind === 'file').map(entry => [entry.path, entry.content_digest]),
      });
      mkdirSync(outputRoot, { recursive: true });
      const artifact = path.join(outputRoot, 'artifact.json');
      writeFileSync(artifact, payload);
      const bytes = readFileSync(artifact);
      return {
        artifact_digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        artifact_manifest: { artifact_path: 'artifact.json', byte_length: bytes.byteLength },
      };
    },
  };
}

function buildGitFixture(root: string, outsideRoot: string): void {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'package.json', JSON.stringify({ name: 'shop', private: true, scripts: { test: 'node --test', lint: 'eslint .' } }, null, 2) + '\n');
  write(root, 'src/checkout.js', 'export const total = items => items.reduce((sum, item) => sum + item.price, 0);\n');
  write(root, `src/${UNICODE_DIR}/cafe.js`, 'export const label = "cafe";\n');
  write(root, 'docs/README.md', '# Shop\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'baseline');
  // Uncommitted client work that onboarding must preserve exactly.
  write(root, 'src/checkout.js', 'export const total = items => items.reduce((sum, item) => sum + item.price, 0); // client edit\n');
  write(root, 'src/promo.js', 'export const promo = "untracked client work";\n');
  // A private directory outside the authorized root, reachable only through a symlink.
  mkdirSync(outsideRoot, { recursive: true });
  writeFileSync(path.join(outsideRoot, 'secrets.env'), 'TOKEN=must-never-be-read\n');
}

function buildPolyglotFixture(root: string): void {
  write(root, 'ios/Package.swift', '// swift-tools-version:5.9\nimport PackageDescription\nlet package = Package(name: "Shop")\n');
  write(root, 'ios/Sources/Shop/Order.swift', 'struct Order { let total: Int }\n');
  write(root, 'gateway/go.mod', 'module example.com/gateway\n\ngo 1.23\n');
  write(root, 'gateway/main.go', 'package main\n\nfunc main() {}\n');
  write(root, 'pricing/pyproject.toml', '[project]\nname = "pricing"\nversion = "0.1.0"\n');
  write(root, 'pricing/pricing.py', 'def total(items):\n    return sum(items)\n');
  write(root, 'model/retrieval.model.json', '{"embedding": "fixture-v1", "top_k": 4}\n');
  write(root, 'tools/report.fixturelang', 'emit report where total > 0\n');
}

function buildCSharpFixture(root: string): void {
  write(root, 'Shop.csproj', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n');
  write(root, 'Program.cs', 'internal static class Program { private static void Main() { } }\n');
}

registerScenario('AT-003', async (): Promise<ScenarioObservation> => {
  const evidence = await Evidence.open('T03');
  const clock = fixedClock('2026-09-07T14:00:00.000Z');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t03-'));
  const repo = path.join(sandbox, 'authorized', 'shop');
  const outside = path.join(sandbox, 'private-elsewhere');
  const polyglot = path.join(sandbox, 'authorized', 'polyglot');
  const csharp = path.join(sandbox, 'authorized', 'csharp');
  const stateDir = path.join(sandbox, 'state');
  const log: Record<string, unknown> = {};

  buildGitFixture(repo, outside);
  buildPolyglotFixture(polyglot);
  buildCSharpFixture(csharp);

  const db = ControllerDatabase.open(stateDir);
  try {
    const service = new LifecycleService(db, { clock });
    service.registerProject({ project_id: PROJECT, registered_root_ref: `file://${repo}`, profile_id: 'discover', data_class: 'internal' });

    // 1. Onboarding reads the checkout and leaves every client byte where it was.
    const before = { fingerprint: treeFingerprint(repo), git: readGitState(repo) };
    const onboarding = onboard({ project_id: PROJECT, authorized_root: repo, now: clock() });
    const after = { fingerprint: treeFingerprint(repo), git: readGitState(repo) };
    log['onboarding'] = {
      before, after, head: onboarding.git.head,
      modified_tracked: onboarding.git.modified_tracked, untracked: onboarding.git.untracked,
      discovered_checks: onboarding.inventory.components.flatMap(component => component.required_check_ids),
    };
    const originalChangesPreserved =
      before.fingerprint === after.fingerprint &&
      onboarding.git.modified_tracked.includes('src/checkout.js') &&
      onboarding.git.untracked.includes('src/promo.js') &&
      onboarding.inventory.components.some(component => component.required_check_ids.includes('npm:test'));

    // 2. Traversal order must not reach the digest; a byte change must.
    const forward = snapshot(repo, onboarding.registered_root_ref);
    const reversed = snapshot(repo, onboarding.registered_root_ref, { order: names => [...names].reverse() });
    const shuffled = buildManifest(onboarding.registered_root_ref, [...forward.entries].reverse());
    const orderIndependent = forward.source_digest === reversed.source_digest && forward.source_digest === shuffled.source_digest;
    write(repo, 'src/promo.js', 'export const promo = "untracked client work, edited";\n');
    const afterUntrackedEdit = snapshot(repo, onboarding.registered_root_ref);
    log['digests'] = {
      forward: forward.source_digest, reversed: reversed.source_digest, shuffled: shuffled.source_digest,
      after_untracked_edit: afterUntrackedEdit.source_digest, entry_count: forward.entry_count,
      unicode_entry: forward.entries.some(entry => entry.path.includes(UNICODE_DIR)),
    };
    const untrackedEditChangesDigest = afterUntrackedEdit.source_digest !== forward.source_digest;

    // 3. A symlink leaving the authorized root is refused; the private file is never read.
    symlinkSync(outside, path.join(repo, 'escape-link'));
    const escape = attempt(() => snapshot(repo, onboarding.registered_root_ref));
    rmSync(path.join(repo, 'escape-link'));
    symlinkSync(path.join(repo, 'docs', 'README.md'), path.join(repo, 'docs', 'readme-link.md'));
    const withInternalLink = attempt(() => snapshot(repo, onboarding.registered_root_ref));
    log['path_escape'] = {
      escaping: escape,
      internal_symlink_recorded: withInternalLink.ok &&
        withInternalLink.value.entries.some(entry => entry.kind === 'symlink' && entry.path === 'docs/readme-link.md'),
    };
    const pathEscapeRejected = !escape.ok && escape.message.startsWith('SYMLINK_ESCAPES_ROOT');

    // 4. Two writers cannot hold overlapping scope, or the project's single writer slot.
    const requestFixture = JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples/request.json'), 'utf8')) as ClientRequest;
    const run = await service.createRun({ ...requestFixture, request_id: 'request_t03', project_id: PROJECT }, 'idem-t03');
    const base = onboarding.manifest.source_digest;
    const claims: Array<[string, string[]]> = [
      ['attempt_a', ['src/']],
      ['attempt_b', [`src/${UNICODE_DIR}/`]],
      ['attempt_c', ['docs/']],
    ];
    for (const [attempt_id, paths] of claims) {
      service.createAttempt({
        attempt_id, project_id: PROJECT, run_id: run.run_id, task_id: `task_${attempt_id}`, attempt_number: 1,
        role: 'writer', parent_attempt_id: null, depth: 0, workspace_id: `ws_${attempt_id}`,
        base_source_digest: base, allowed_write_paths: paths, dependency_task_ids: [],
        deadline: '2026-09-08T00:00:00.000Z', provider_session_id: null,
      });
    }
    const claimA = claimWriteScope(db, {
      project_id: PROJECT, attempt_id: 'attempt_a', workspace_id: 'ws_attempt_a',
      owner_id: 'writer_one', paths: ['src/'], expires_at: '2026-09-08T00:00:00.000Z',
    });
    const overlapping = attempt(() => claimWriteScope(db, {
      project_id: PROJECT, attempt_id: 'attempt_b', workspace_id: 'ws_attempt_b',
      owner_id: 'writer_two', paths: [`src/${UNICODE_DIR}/`], expires_at: '2026-09-08T00:00:00.000Z',
    }));
    const secondWriter = attempt(() => claimWriteScope(db, {
      project_id: PROJECT, attempt_id: 'attempt_c', workspace_id: 'ws_attempt_c',
      owner_id: 'writer_three', paths: ['docs/'], expires_at: '2026-09-08T00:00:00.000Z',
    }));
    const inScope = checkIntegration(db, {
      project_id: PROJECT, attempt_id: 'attempt_a', lease_epoch: claimA.epoch,
      base_source_digest: base, changed_paths: ['src/checkout.js'],
    });
    const outOfScope = checkIntegration(db, {
      project_id: PROJECT, attempt_id: 'attempt_a', lease_epoch: claimA.epoch,
      base_source_digest: base, changed_paths: ['docs/README.md'],
    });
    log['ownership'] = {
      claim_a_epoch: claimA.epoch, overlapping, second_writer: secondWriter,
      disjoint_integration: inScope, out_of_scope_integration: outOfScope,
    };
    const overlappingWriterRejected =
      !overlapping.ok && overlapping.message.startsWith('OVERLAPPING_WRITE_CLAIM') &&
      !secondWriter.ok && secondWriter.code === 'WRITER_LEASE_CONFLICT' &&
      inScope.accepted && !outOfScope.accepted && outOfScope.reason === 'PATH_NOT_OWNED';

    // 5. Sealing binds source, artifact, requirements revision, policy and environment.
    const contractFixture = JSON.parse(readFileSync(path.join(ROOT, 'contracts/examples/contract.json'), 'utf8')) as Contract;
    const contract: Contract = { ...contractFixture, contract_id: 'contract_t03', project_id: PROJECT, request_ids: ['request_t03'] };
    service.recordContract(contract);
    const builder = makeBuilder(path.join(sandbox, 'build-output'));
    const sealed = sealCandidate(db, {
      project_id: PROJECT, run_id: run.run_id, workspace_root: repo, workspace_ref: onboarding.registered_root_ref,
      contract, policy_digest: `sha256:${'f'.repeat(64)}`, builder, now: clock(),
    });
    const candidateValid = validateEntity(sealed.candidate);
    log['seal'] = { candidate: sealed.candidate, artifact_manifest: sealed.artifact_manifest, schema: candidateValid };

    // 6. Polyglot onboarding preserves every component and its own toolchain.
    const polyglotBefore = treeFingerprint(polyglot);
    const polyglotOnboarding = onboard({ project_id: 'project_t03_polyglot', authorized_root: polyglot, now: clock() });
    const polyglotAfter = treeFingerprint(polyglot);
    const languages = new Set(polyglotOnboarding.inventory.components.flatMap(component => component.languages));
    const context = toEngineeringContext({
      context_id: 'ctx_t03', project_id: 'project_t03_polyglot', task_id: 'task_polyglot',
      source_digest: polyglotOnboarding.manifest.source_digest, requirements_revision: 1,
      inventory: polyglotOnboarding.inventory,
    });
    const contextValid = validateEntity(context);
    log['polyglot'] = {
      preserved: polyglotBefore === polyglotAfter,
      components: polyglotOnboarding.inventory.components.map(component => ({
        id: component.component_id, languages: component.languages, checks: component.required_check_ids,
        grounding: component.grounding_status, gaps: component.capability_gaps,
      })),
      unrecognised_languages: polyglotOnboarding.inventory.unrecognised_languages,
      engineering_context_schema: contextValid,
    };
    const polyglotPreserved = polyglotBefore === polyglotAfter && contextValid.valid &&
      ['Swift', 'Go', 'Python'].every(language => languages.has(language)) &&
      polyglotOnboarding.inventory.components.some(component => component.root_ref === 'ios');

    // 7. A non-JavaScript source edit changes the sealed identity.
    const swiftBefore = polyglotOnboarding.manifest.source_digest;
    write(polyglot, 'ios/Sources/Shop/Order.swift', 'struct Order { let total: Int; let currency: String }\n');
    const afterSwift = snapshot(polyglot, polyglotOnboarding.registered_root_ref).source_digest;
    write(polyglot, 'model/retrieval.model.json', '{"embedding": "fixture-v2", "top_k": 8}\n');
    const afterModel = snapshot(polyglot, polyglotOnboarding.registered_root_ref).source_digest;
    log['non_js_edits'] = { before: swiftBefore, after_swift: afterSwift, after_model_config: afterModel };
    const nonJsEditChangesDigest = afterSwift !== swiftBefore && afterModel !== afterSwift;

    // 8. Intake has no TypeScript gate: a C#-only project and an unknown language both pass.
    const csharpOnboarding = onboard({ project_id: 'project_t03_csharp', authorized_root: csharp, now: clock() });
    const csharpLanguages = new Set(csharpOnboarding.inventory.components.flatMap(component => component.languages));
    const unrecognised = inventoryStack(polyglot).unrecognised_languages;
    log['no_whitelist'] = {
      csharp_components: csharpOnboarding.inventory.components.map(component => ({
        id: component.component_id, languages: component.languages, checks: component.required_check_ids,
      })),
      unrecognised_languages: unrecognised,
    };
    const noWhitelist = csharpLanguages.has('C#') && !csharpLanguages.has('TypeScript') &&
      csharpOnboarding.inventory.components.length > 0 && unrecognised.includes('fixturelang');

    // 9. Cleanup removes only owned temporary workspaces.
    const controllerWorkspaces = path.join(sandbox, 'workspaces');
    const ownedWorkspace = path.join(controllerWorkspaces, 'ws_attempt_a');
    mkdirSync(ownedWorkspace, { recursive: true });
    const disposed = attempt(() => disposeWorkspace({
      workspace_root: ownedWorkspace, controller_workspace_root: controllerWorkspaces, registered_roots: [`file://${repo}`],
    }));
    const refusedClientRoot = attempt(() => disposeWorkspace({
      workspace_root: repo, controller_workspace_root: controllerWorkspaces, registered_roots: [`file://${repo}`],
    }));
    log['cleanup'] = { disposed, refused_client_root: refusedClientRoot, client_root_intact: treeFingerprint(repo) };

    await evidence.write('workspace.json', log);
    await evidence.write('source-manifest.json', forward);
    await evidence.write('engineering-context.json', context);

    return {
      scenario_id: 'AT-003',
      mode: 'integration',
      observed: {
        original_changes_preserved: originalChangesPreserved,
        order_independent_digest: orderIndependent,
        untracked_edit_changes_digest: untrackedEditChangesDigest,
        path_escape_rejected: pathEscapeRejected,
        overlapping_writer_rejected: overlappingWriterRejected,
        polyglot_components_preserved: polyglotPreserved,
        non_js_source_edit_changes_digest: nonJsEditChangesDigest,
        no_typescript_intake_whitelist: noWhitelist,
        candidate_schema_valid: candidateValid.valid,
        client_root_survives_cleanup: !refusedClientRoot.ok && disposed.ok,
      } satisfies Record<string, Json>,
      artifact_paths: evidence.paths,
    };
  } finally {
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
