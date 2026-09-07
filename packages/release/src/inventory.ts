/** What ships with the release.
 *
 * A release inventory is only useful if it is generated from the tree that is actually being
 * shipped. Everything here is read from disk at the moment of the rehearsal: file checksums,
 * the installed version and licence of every declared dependency, the runbooks that exist,
 * the retention periods in force, and the named owner for support and incidents.
 *
 * A missing section is reported as missing. An inventory that quietly omits a dependency
 * whose licence could not be read is worse than no inventory.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { RETENTION_DAYS } from '../../observability/src/metrics.js';

export type DependencyRecord = {
  name: string;
  declared_range: string;
  installed_version: string | null;
  license: string | null;
  license_file: string | null;
  status: 'complete' | 'missing_version' | 'missing_license';
};

export type InventorySection = { name: string; present: boolean; detail: string };

export type ReleaseInventory = {
  generated_at: string;
  source_root: string;
  artifacts: Array<{ provider: string; version: string; distribution_digest: string; files: number; archive_digest: string | null }>;
  dependencies: DependencyRecord[];
  supported_versions: Record<string, string>;
  runbooks: string[];
  retention_days: Record<string, number>;
  support_ownership: { file: string; owner: string | null; response_target: string | null } | null;
  test_report: { gates: string[]; evidence_directories: string[] };
  sections: InventorySection[];
  complete: boolean;
  gaps: string[];
};

function digestFile(file: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

function readDependencies(source_root: string): DependencyRecord[] {
  const manifest = JSON.parse(readFileSync(path.join(source_root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  };
  const declared = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  return Object.entries(declared).sort(([left], [right]) => left.localeCompare(right)).map(([name, declared_range]) => {
    const installed = path.join(source_root, 'node_modules', name, 'package.json');
    if (!existsSync(installed)) {
      return { name, declared_range, installed_version: null, license: null, license_file: null, status: 'missing_version' as const };
    }
    const info = JSON.parse(readFileSync(installed, 'utf8')) as { version?: string; license?: string; licenses?: Array<{ type?: string }> };
    const license = info.license ?? info.licenses?.[0]?.type ?? null;
    const directory = path.dirname(installed);
    const license_file = readdirSync(directory).find(entry => /^(LICEN[CS]E|COPYING)/i.test(entry)) ?? null;
    return {
      name, declared_range,
      installed_version: info.version ?? null,
      license, license_file: license_file === null ? null : path.join('node_modules', name, license_file),
      status: info.version === undefined ? 'missing_version' as const
        : license === null && license_file === null ? 'missing_license' as const : 'complete' as const,
    };
  });
}

export function buildInventory(input: {
  source_root: string;
  generated_at: string;
  artifacts: Array<{ provider: string; version: string; distribution_digest: string; files: number; archive_path: string | null }>;
  supported_versions: Record<string, string>;
  gate_names: string[];
}): ReleaseInventory {
  const dependencies = readDependencies(input.source_root);
  const runbookDirectory = path.join(input.source_root, 'docs', 'runbooks');
  const runbooks = existsSync(runbookDirectory)
    ? readdirSync(runbookDirectory).filter(entry => entry.endsWith('.md')).sort()
    : [];
  const supportFile = path.join(input.source_root, 'SUPPORT.md');
  const support_ownership = existsSync(supportFile) ? (() => {
    const text = readFileSync(supportFile, 'utf8');
    return {
      file: 'SUPPORT.md',
      owner: /^-\s*Owner:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null,
      response_target: /^-\s*Response target:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null,
    };
  })() : null;
  const evidenceRoot = path.join(input.source_root, 'qa', 'product');
  const evidence_directories = existsSync(evidenceRoot)
    ? readdirSync(evidenceRoot).filter(entry => statSync(path.join(evidenceRoot, entry)).isDirectory()).sort()
    : [];

  const artifacts = input.artifacts.map(artifact => ({
    provider: artifact.provider, version: artifact.version,
    distribution_digest: artifact.distribution_digest, files: artifact.files,
    archive_digest: artifact.archive_path !== null && existsSync(artifact.archive_path) ? digestFile(artifact.archive_path) : null,
  }));

  const sections: InventorySection[] = [
    { name: 'source_and_artifact_checksums', present: artifacts.length > 0 && artifacts.every(artifact => artifact.archive_digest !== null), detail: `${artifacts.length} distributions with archive checksums` },
    { name: 'dependency_and_license_inventory', present: dependencies.length > 0 && dependencies.every(dependency => dependency.status === 'complete'), detail: `${dependencies.length} dependencies` },
    { name: 'supported_versions', present: Object.keys(input.supported_versions).length >= 3, detail: Object.keys(input.supported_versions).join(', ') },
    { name: 'test_report', present: input.gate_names.length > 0 && evidence_directories.length >= input.gate_names.length, detail: `${input.gate_names.length} gates, ${evidence_directories.length} evidence directories` },
    { name: 'runbooks', present: runbooks.length >= 3, detail: runbooks.join(', ') },
    { name: 'retention', present: Object.keys(RETENTION_DAYS).length > 0, detail: Object.entries(RETENTION_DAYS).map(([key, value]) => `${key}=${String(value)}d`).join(', ') },
    { name: 'support_and_incident_ownership', present: support_ownership !== null && support_ownership.owner !== null && support_ownership.response_target !== null, detail: support_ownership === null ? 'SUPPORT.md absent' : `owner ${String(support_ownership.owner)}` },
  ];
  const gaps = sections.filter(section => !section.present).map(section => section.name)
    .concat(dependencies.filter(dependency => dependency.status !== 'complete').map(dependency => `dependency:${dependency.name}:${dependency.status}`));

  return {
    generated_at: input.generated_at, source_root: input.source_root, artifacts, dependencies,
    supported_versions: input.supported_versions, runbooks, retention_days: { ...RETENTION_DAYS },
    support_ownership, test_report: { gates: input.gate_names, evidence_directories },
    sections, complete: gaps.length === 0, gaps,
  };
}
