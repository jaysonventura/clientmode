/** Building the two native distributions from one source tree.
 *
 * The skills are authored once. Each provider gets its own package in its own documented
 * layout, self-contained: every file the host needs is inside the distribution, so installing
 * it does not reach back into this repository at runtime.
 *
 * A manifest that does not parse, or that names a file the package does not contain, is a
 * build failure. A distribution is not "probably fine".
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SKILLS_DIRECTORY } from './hosts.js';

export type ProviderTarget = 'claude' | 'codex';

export class PackagingError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'PackagingError';
  }
}

export type Distribution = {
  provider: ProviderTarget;
  root: string;
  version: string;
  manifest_path: string;
  files: Array<{ path: string; bytes: number; digest: string }>;
  distribution_digest: string;
  self_contained: boolean;
  external_references: string[];
};

export type SkillSource = { name: string; body: string };

function readSkills(skillsRoot: string): SkillSource[] {
  return readdirSync(skillsRoot)
    .filter(entry => statSync(path.join(skillsRoot, entry)).isDirectory())
    .map(name => {
      const file = path.join(skillsRoot, name, 'SKILL.md');
      return { name, body: readFileSync(file, 'utf8') };
    });
}

/** Front matter must carry a name and a description, or the host cannot route to the skill. */
function validateSkill(skill: SkillSource): void {
  const match = /^---\n([\s\S]*?)\n---/.exec(skill.body);
  if (match === null) throw new PackagingError('SKILL_MISSING_FRONT_MATTER', skill.name);
  const front = match[1] ?? '';
  if (!/^name:\s*\S+/m.test(front)) throw new PackagingError('SKILL_MISSING_NAME', skill.name);
  if (!/^description:\s*\S+/m.test(front)) throw new PackagingError('SKILL_MISSING_DESCRIPTION', skill.name);
}

function digestOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function collect(root: string, prefix = ''): Array<{ path: string; bytes: number; digest: string }> {
  const files: Array<{ path: string; bytes: number; digest: string }> = [];
  for (const entry of readdirSync(root).sort()) {
    const absolute = path.join(root, entry);
    const relative = prefix === '' ? entry : `${prefix}/${entry}`;
    if (statSync(absolute).isDirectory()) { files.push(...collect(absolute, relative)); continue; }
    const bytes = readFileSync(absolute);
    files.push({ path: relative, bytes: bytes.byteLength, digest: digestOf(bytes) });
  }
  return files;
}

/** A distribution is self-contained when nothing inside it points back at the build tree. */
function findExternalReferences(root: string, sourceRoot: string): string[] {
  const offenders: string[] = [];
  for (const file of collect(root)) {
    const text = readFileSync(path.join(root, file.path), 'utf8');
    if (text.includes(sourceRoot)) offenders.push(file.path);
    if (/\.\.\/\.\.\//.test(text)) offenders.push(`${file.path}:parent-traversal`);
  }
  return [...new Set(offenders)];
}

export function buildDistribution(input: {
  provider: ProviderTarget; source_root: string; out_root: string; version: string;
}): Distribution {
  const skillsRoot = path.join(input.source_root, SKILLS_DIRECTORY);
  const skills = readSkills(skillsRoot);
  if (skills.length === 0) throw new PackagingError('NO_SKILLS_FOUND', skillsRoot);
  for (const skill of skills) validateSkill(skill);

  const root = path.join(input.out_root, input.provider);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  let manifest_path: string;
  if (input.provider === 'claude') {
    // Claude plugin layout: a plugin manifest beside the skills it ships.
    mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    manifest_path = path.join(root, '.claude-plugin/plugin.json');
    writeFileSync(manifest_path, JSON.stringify({
      name: 'client-mode',
      version: input.version,
      description: 'Client Mode delivery procedures: intake, grounding, delivery, debugging, review, verification, UI/UX and handoff.',
      author: { name: 'Client Mode' },
    }, null, 2) + '\n');
    for (const skill of skills) {
      mkdirSync(path.join(root, 'skills', skill.name), { recursive: true });
      writeFileSync(path.join(root, 'skills', skill.name, 'SKILL.md'), skill.body);
    }
    copyFileSync(path.join(input.source_root, 'adapters/claude/CLAUDE.md'), path.join(root, 'CLAUDE.md'));
  } else {
    // Codex layout: instructions the host loads plus the same skills as reference material.
    manifest_path = path.join(root, 'client-mode.json');
    writeFileSync(manifest_path, JSON.stringify({
      name: 'client-mode',
      version: input.version,
      instructions_file: 'AGENTS.md',
      skills: skills.map(skill => `skills/${skill.name}/SKILL.md`),
    }, null, 2) + '\n');
    for (const skill of skills) {
      mkdirSync(path.join(root, 'skills', skill.name), { recursive: true });
      writeFileSync(path.join(root, 'skills', skill.name, 'SKILL.md'), skill.body);
    }
    copyFileSync(path.join(input.source_root, 'adapters/codex/AGENTS.md'), path.join(root, 'AGENTS.md'));
  }

  validateManifest(input.provider, manifest_path, root);
  const files = collect(root);
  const external_references = findExternalReferences(root, input.source_root);
  return {
    provider: input.provider, root, version: input.version, manifest_path, files,
    distribution_digest: `sha256:${createHash('sha256').update(files.map(file => `${file.path}:${file.digest}`).join('\n')).digest('hex')}`,
    self_contained: external_references.length === 0,
    external_references,
  };
}

/** Parse the manifest and check that every file it names exists in the package. */
export function validateManifest(provider: ProviderTarget, manifest_path: string, root: string): Record<string, unknown> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifest_path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new PackagingError('MANIFEST_NOT_PARSEABLE', String((error as Error).message));
  }
  if (typeof manifest['name'] !== 'string' || typeof manifest['version'] !== 'string') {
    throw new PackagingError('MANIFEST_MISSING_IDENTITY', manifest_path);
  }
  if (provider === 'claude') {
    if (path.basename(manifest_path) !== 'plugin.json' || path.basename(path.dirname(manifest_path)) !== '.claude-plugin') {
      throw new PackagingError('MANIFEST_WRONG_LOCATION', manifest_path);
    }
  } else {
    const referenced = [String(manifest['instructions_file'] ?? ''), ...((manifest['skills'] as string[] | undefined) ?? [])];
    for (const reference of referenced) {
      if (reference === '') continue;
      try {
        statSync(path.join(root, reference));
      } catch {
        throw new PackagingError('MANIFEST_REFERENCES_MISSING_FILE', reference);
      }
    }
  }
  return manifest;
}
