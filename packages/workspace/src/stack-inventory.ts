/** Component discovery for any stack. The tables below are recognition aids, not an intake
 * whitelist: an unrecognised language still produces a component that needs grounding, never
 * a rejected request or a silent rewrite into the toolkit's own language.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineeringComponent, EngineeringContext } from '../../../contracts/interfaces.js';
import { selectEntries, type ManifestEntry, type SelectOptions } from './snapshot.js';

type Signature = {
  domain: string;
  languages: string[];
  frameworks: string[];
  target_platforms: string[];
  /** [check id, executable that must exist for it to run] */
  checks: Array<[string, string]>;
};

const MANIFESTS: Record<string, Signature> = {
  'package.json': { domain: 'web', languages: ['JavaScript'], frameworks: [], target_platforms: ['browser', 'node'], checks: [['npm:test', 'npm']] },
  'go.mod': { domain: 'backend', languages: ['Go'], frameworks: [], target_platforms: ['server'], checks: [['go:test', 'go'], ['go:vet', 'go']] },
  'Package.swift': { domain: 'native', languages: ['Swift'], frameworks: ['SwiftPM'], target_platforms: ['macOS', 'iOS'], checks: [['swift:test', 'swift']] },
  'pyproject.toml': { domain: 'backend', languages: ['Python'], frameworks: [], target_platforms: ['server'], checks: [['python:pytest', 'python3']] },
  'requirements.txt': { domain: 'backend', languages: ['Python'], frameworks: [], target_platforms: ['server'], checks: [['python:pytest', 'python3']] },
  'Cargo.toml': { domain: 'systems', languages: ['Rust'], frameworks: [], target_platforms: ['native'], checks: [['cargo:test', 'cargo']] },
  'pom.xml': { domain: 'backend', languages: ['Java'], frameworks: ['Maven'], target_platforms: ['jvm'], checks: [['maven:test', 'mvn']] },
  'build.gradle': { domain: 'backend', languages: ['Java'], frameworks: ['Gradle'], target_platforms: ['jvm'], checks: [['gradle:test', 'gradle']] },
  'build.gradle.kts': { domain: 'mobile', languages: ['Kotlin'], frameworks: ['Gradle'], target_platforms: ['android'], checks: [['gradle:test', 'gradle']] },
  'Gemfile': { domain: 'backend', languages: ['Ruby'], frameworks: [], target_platforms: ['server'], checks: [['bundle:test', 'bundle']] },
  'composer.json': { domain: 'backend', languages: ['PHP'], frameworks: [], target_platforms: ['server'], checks: [['composer:test', 'composer']] },
  'pubspec.yaml': { domain: 'mobile', languages: ['Dart'], frameworks: ['Flutter'], target_platforms: ['android', 'iOS'], checks: [['flutter:test', 'flutter']] },
  'CMakeLists.txt': { domain: 'systems', languages: ['C++'], frameworks: ['CMake'], target_platforms: ['native'], checks: [['ctest', 'ctest']] },
  'mix.exs': { domain: 'backend', languages: ['Elixir'], frameworks: ['Mix'], target_platforms: ['server'], checks: [['mix:test', 'mix']] },
};

const MANIFEST_SUFFIXES: Array<[string, Signature]> = [
  ['.csproj', { domain: 'backend', languages: ['C#'], frameworks: ['.NET'], target_platforms: ['Windows', 'Linux'], checks: [['dotnet:test', 'dotnet']] }],
  ['.sln', { domain: 'backend', languages: ['C#'], frameworks: ['.NET'], target_platforms: ['Windows', 'Linux'], checks: [['dotnet:test', 'dotnet']] }],
  ['.xcodeproj', { domain: 'native', languages: ['Swift'], frameworks: ['Xcode'], target_platforms: ['iOS'], checks: [['xcodebuild:test', 'xcodebuild']] }],
];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', go: 'Go', swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin', java: 'Java', cs: 'C#', rb: 'Ruby',
  php: 'PHP', rs: 'Rust', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', m: 'Objective-C', mm: 'Objective-C++',
  dart: 'Dart', scala: 'Scala', ex: 'Elixir', exs: 'Elixir', sh: 'Shell', sql: 'SQL', tf: 'Terraform', lua: 'Lua',
};

const NON_SOURCE_EXTENSIONS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'toml', 'lock', 'png', 'jpg', 'jpeg', 'svg', 'ico', 'gitignore']);

function extensionOf(file: string): string {
  const base = path.basename(file);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** An unmapped extension becomes an observed language token, so the component is recorded
 * as needing grounding instead of being filtered out of intake. */
function languageOf(file: string): { language: string; recognised: boolean } | undefined {
  const extension = extensionOf(file);
  if (extension === '' || NON_SOURCE_EXTENSIONS.has(extension)) return undefined;
  const known = LANGUAGE_BY_EXTENSION[extension];
  return known ? { language: known, recognised: true } : { language: extension, recognised: false };
}

/** Contract IDs are opaque tokens, so a directory path becomes a slug and the real path
 * is kept in source_refs where free text is allowed. */
function slug(relativeDirectory: string): string {
  const token = relativeDirectory.replace(/[/\\]/g, '.').replace(/[^A-Za-z0-9_.:-]/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return token.length === 0 ? 'root' : token.slice(0, 120);
}

function signatureFor(file: string): Signature | undefined {
  const base = path.basename(file);
  const exact = MANIFESTS[base];
  if (exact) return exact;
  return MANIFEST_SUFFIXES.find(([suffix]) => base.endsWith(suffix))?.[1];
}

/** package.json scripts are actual discovered commands, not assumed ones. */
function npmScriptChecks(root: string, componentRoot: string): Array<[string, string]> {
  const manifest = path.join(root, componentRoot, 'package.json');
  if (!existsSync(manifest)) return [];
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, string> };
    return Object.keys(parsed.scripts ?? {}).filter(name => ['test', 'lint', 'typecheck', 'build'].includes(name))
      .map(name => [`npm:${name}`, 'npm'] as [string, string]);
  } catch {
    return [];
  }
}

export type StackInventory = {
  components: EngineeringComponent[];
  unrecognised_languages: string[];
  observed_at: string;
};

function toolAvailable(executable: string, whichPaths = process.env['PATH'] ?? ''): boolean {
  return whichPaths.split(path.delimiter).some(directory => directory !== '' && existsSync(path.join(directory, executable)));
}

/** One component per discovered manifest directory, plus one for source the manifests miss. */
export function inventoryStack(root: string, options: SelectOptions & { now?: string } = {}): StackInventory {
  const entries: ManifestEntry[] = selectEntries(root, options);
  const componentRoots = new Map<string, { signature: Signature; sources: string[] }>();
  for (const entry of entries) {
    const signature = signatureFor(entry.path);
    if (!signature) continue;
    const componentRoot = path.dirname(entry.path) === '.' ? '' : path.dirname(entry.path);
    const existing = componentRoots.get(componentRoot);
    if (existing) {
      existing.signature = {
        ...existing.signature,
        languages: [...new Set([...existing.signature.languages, ...signature.languages])],
        frameworks: [...new Set([...existing.signature.frameworks, ...signature.frameworks])],
        target_platforms: [...new Set([...existing.signature.target_platforms, ...signature.target_platforms])],
        checks: [...existing.signature.checks, ...signature.checks],
      };
      existing.sources.push(entry.path);
    } else {
      componentRoots.set(componentRoot, { signature: { ...signature }, sources: [entry.path] });
    }
  }

  const owner = (file: string): string | undefined => {
    let best: string | undefined;
    for (const componentRoot of componentRoots.keys()) {
      const inside = componentRoot === '' || file === componentRoot || file.startsWith(`${componentRoot}/`);
      if (inside && (best === undefined || componentRoot.length > best.length)) best = componentRoot;
    }
    return best;
  };

  const observedLanguages = new Map<string, Set<string>>();
  const unrecognised = new Set<string>();
  const unowned: string[] = [];
  for (const entry of entries) {
    // A manifest declares a component; it is not itself source in that component's language.
    if (signatureFor(entry.path)) continue;
    const detected = languageOf(entry.path);
    if (!detected) continue;
    if (!detected.recognised) unrecognised.add(detected.language);
    const componentRoot = owner(entry.path);
    if (componentRoot === undefined) { unowned.push(entry.path); continue; }
    const set = observedLanguages.get(componentRoot) ?? new Set<string>();
    set.add(detected.language);
    observedLanguages.set(componentRoot, set);
  }

  const components: EngineeringComponent[] = [];
  for (const [componentRoot, { signature, sources }] of componentRoots) {
    const languages = [...new Set([...signature.languages, ...(observedLanguages.get(componentRoot) ?? [])])].sort();
    const discovered = [...signature.checks, ...npmScriptChecks(root, componentRoot)];
    const missing = [...new Set(discovered.filter(([, executable]) => !toolAvailable(executable)).map(([, executable]) => executable))];
    const gaps = missing.map(executable => `Required toolchain not available on this host: ${executable}`);
    const check_ids = [...new Set(discovered.map(([id]) => id))];
    if (check_ids.length === 0) {
      check_ids.push('check:UNDETERMINED');
      gaps.push('No project-native check discovered for this component');
    }
    components.push({
      component_id: `component.${slug(componentRoot)}`,
      root_ref: slug(componentRoot),
      domain: signature.domain,
      languages,
      frameworks: [...new Set(signature.frameworks)].sort(),
      target_platforms: [...new Set(signature.target_platforms)].sort(),
      environment_ref: null,
      grounding_status: gaps.length > 0 ? 'BLOCKED' : 'GROUNDED',
      source_refs: sources.sort(),
      required_check_ids: check_ids.sort(),
      capability_gaps: gaps,
    });
  }

  if (unowned.length > 0) {
    const languages = [...new Set(unowned.map(file => languageOf(file)?.language).filter((value): value is string => value !== undefined))].sort();
    components.push({
      component_id: 'component.unclassified',
      root_ref: 'root',
      domain: 'unclassified',
      languages,
      frameworks: [],
      target_platforms: ['undetermined'],
      environment_ref: null,
      grounding_status: 'NEEDS_GROUNDING',
      source_refs: unowned.sort().slice(0, 50),
      required_check_ids: ['check:UNDETERMINED'],
      capability_gaps: ['Source present without a recognised manifest; ground from the project itself'],
    });
  }

  return {
    components: components.sort((a, b) => (a.component_id < b.component_id ? -1 : 1)),
    unrecognised_languages: [...unrecognised].sort(),
    observed_at: options.now ?? new Date().toISOString(),
  };
}

export function toEngineeringContext(input: {
  context_id: string; project_id: string; task_id: string; source_digest: string;
  requirements_revision: number; inventory: StackInventory;
}): EngineeringContext {
  return {
    kind: 'engineering_context', schema_version: 1,
    context_id: input.context_id, project_id: input.project_id, task_id: input.task_id,
    source_digest: input.source_digest, requirements_revision: input.requirements_revision,
    components: input.inventory.components, observed_at: input.inventory.observed_at,
  };
}
