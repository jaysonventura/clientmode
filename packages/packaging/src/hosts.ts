/** Where each host reads its operating model, and putting Client Mode there.
 *
 * One source of rules and one set of skills, delivered to four hosts in the shape each one
 * documents. Claude Code takes the skills from the `cm` plugin; Codex, Gemini CLI and Cursor all
 * read `~/.agents/skills`, so the skills are written there once. Copying them into a second
 * directory would show every skill twice in Cursor, which reads several of these locations.
 *
 * Rules go into the file each host loads on every session, inside markers, so removal takes back
 * exactly what was added. Cursor has no global instructions file to append to; it gets a rule
 * file of its own, which is removed whole.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const HOSTS = ['claude', 'codex', 'gemini', 'cursor'] as const;
export type HostName = (typeof HOSTS)[number];

/** Where the merged skills live in the source tree and in the installed toolkit. */
export const SKILLS_DIRECTORY = path.join('plugin', 'skills');

export const BLOCK_START = '<!-- client-mode:start -->';
export const BLOCK_END = '<!-- client-mode:end -->';
export const BACKUP_SUFFIX = '.client-mode-backup';

export type HostLayout = {
  host: HostName;
  config_root: string;
  /** The file the host loads at the start of every session. */
  instructions: string;
  /** `block` is appended inside markers; `owned-file` is a file this install creates and removes. */
  instructions_kind: 'block' | 'owned-file';
  /** Where the skills are copied, or null when the host gets them from the `cm` plugin. */
  skills_root: string | null;
  /** How the rules name a skill in this host: `cm:tdd` for a plugin skill, `cm-tdd` for a copy. */
  skill_reference: 'cm:' | 'cm-';
};

export function hostLayout(host: HostName, home: string, env: NodeJS.ProcessEnv): HostLayout {
  const agentsSkills = path.join(home, '.agents', 'skills');
  switch (host) {
    case 'claude': {
      const root = env['CLAUDE_CONFIG_DIR'] ?? path.join(home, '.claude');
      return { host, config_root: root, instructions: path.join(root, 'CLAUDE.md'), instructions_kind: 'block', skills_root: null, skill_reference: 'cm:' };
    }
    case 'codex': {
      const root = env['CODEX_HOME'] ?? path.join(home, '.codex');
      return { host, config_root: root, instructions: path.join(root, 'AGENTS.md'), instructions_kind: 'block', skills_root: agentsSkills, skill_reference: 'cm-' };
    }
    case 'gemini': {
      const root = path.join(env['GEMINI_CLI_HOME'] ?? home, '.gemini');
      return { host, config_root: root, instructions: path.join(root, 'GEMINI.md'), instructions_kind: 'block', skills_root: agentsSkills, skill_reference: 'cm-' };
    }
    case 'cursor': {
      const root = path.join(home, '.cursor');
      return { host, config_root: root, instructions: path.join(root, 'rules', 'client-mode.mdc'), instructions_kind: 'owned-file', skills_root: agentsSkills, skill_reference: 'cm-' };
    }
  }
}

export function stripBlock(text: string): string {
  if (!text.includes(BLOCK_START)) return text;
  const end = text.indexOf(BLOCK_END);
  const without = `${text.slice(0, text.indexOf(BLOCK_START))}${end === -1 ? '' : text.slice(end + BLOCK_END.length)}`;
  // Installing and removing repeatedly must not leave a growing gap where the block used to be.
  return without.replace(/\n{3,}/g, '\n\n').trim();
}

/** The rules as this host should read them. */
export function renderRules(input: { source_root: string; lead: boolean; skill_reference: HostLayout['skill_reference'] }): string {
  const file = input.lead ? 'adapters/global/CLIENT_MODE_LEAD.md' : 'adapters/global/CLIENT_MODE.md';
  const text = readFileSync(path.join(input.source_root, file), 'utf8').trimEnd();
  return input.skill_reference === 'cm-' ? text : text.replace(/`cm-([a-z0-9-]+)`/g, '`cm:$1`');
}

/** Copy one skill directory, renaming it so its front matter matches its folder (`cm-<name>`),
 * which Cursor and Gemini require and every host accepts. */
function copySkill(source: string, target: string, name: string): void {
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  const file = path.join(target, 'SKILL.md');
  const body = readFileSync(file, 'utf8');
  writeFileSync(file, body.replace(/^(---\r?\nname:\s*)(\S+)/, `$1cm-${name}`));
}

export function activateHost(input: { layout: HostLayout; source_root: string; lead: boolean; skills_source?: string }):
  { created: string[]; backups: Array<{ target: string; backup: string }>; summary: string } {
  const { layout } = input;
  const created: string[] = [];
  const backups: Array<{ target: string; backup: string }> = [];
  const skillsSource = input.skills_source ?? path.join(input.source_root, SKILLS_DIRECTORY);

  let skillCount = 0;
  if (layout.skills_root !== null) {
    for (const name of readdirSync(skillsSource).sort()) {
      if (!statSync(path.join(skillsSource, name)).isDirectory()) continue;
      const target = path.join(layout.skills_root, `cm-${name}`);
      mkdirSync(layout.skills_root, { recursive: true });
      copySkill(path.join(skillsSource, name), target, name);
      created.push(target);
      skillCount += 1;
    }
  }

  const rules = renderRules({ source_root: input.source_root, lead: input.lead, skill_reference: layout.skill_reference });
  mkdirSync(path.dirname(layout.instructions), { recursive: true });
  if (layout.instructions_kind === 'owned-file') {
    writeFileSync(layout.instructions, `---\ndescription: Client Mode operating model, installed by cm install\nalwaysApply: true\n---\n\n${rules}\n`);
    created.push(layout.instructions);
  } else {
    const block = `${BLOCK_START}\n${rules}\n${BLOCK_END}\n`;
    const without = existsSync(layout.instructions) ? stripBlock(readFileSync(layout.instructions, 'utf8')).trimEnd() : '';
    if (!existsSync(layout.instructions)) created.push(layout.instructions);
    else {
      // A safety net holding the person's own file. It is the file without our block, so
      // reinstalling over an install cannot turn our text into "the original".
      const backup = `${layout.instructions}${BACKUP_SUFFIX}`;
      if (!existsSync(backup)) { writeFileSync(backup, `${without}\n`); backups.push({ target: layout.instructions, backup }); }
    }
    // Lead mode goes first and says so; nothing that was there is deleted.
    writeFileSync(layout.instructions, without === '' ? block : input.lead ? `${block}\n${without}\n` : `${without}\n\n${block}`);
  }

  return {
    created, backups,
    summary: `${layout.host}: rules in ${layout.instructions}` +
      (layout.skills_root === null ? '; skills from the cm plugin' : `; ${String(skillCount)} skill(s) in ${layout.skills_root}`),
  };
}

/** Take back the rules and, when asked, the skills. A skill without the `cm-` prefix is never
 * ours, and an instructions file left empty is removed only because an empty file is what we
 * would otherwise leave behind. */
export function deactivateHost(input: { layout: HostLayout; remove_skills: boolean }): { removed: string[] } {
  const { layout } = input;
  const removed: string[] = [];
  if (input.remove_skills && layout.skills_root !== null && existsSync(layout.skills_root)) {
    for (const entry of readdirSync(layout.skills_root)) {
      if (!entry.startsWith('cm-')) continue;
      rmSync(path.join(layout.skills_root, entry), { recursive: true, force: true });
      removed.push(path.join(layout.skills_root, entry));
    }
    if (readdirSync(layout.skills_root).length === 0) {
      rmSync(layout.skills_root, { recursive: true, force: true });
      const parent = path.dirname(layout.skills_root);
      if (existsSync(parent) && readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
    }
  }
  if (!existsSync(layout.instructions)) return { removed };
  if (layout.instructions_kind === 'owned-file') {
    rmSync(layout.instructions, { force: true });
    removed.push(layout.instructions);
    const rules = path.dirname(layout.instructions);
    if (readdirSync(rules).length === 0) rmSync(rules, { recursive: true, force: true });
    return { removed };
  }
  const stripped = stripBlock(readFileSync(layout.instructions, 'utf8')).trimEnd();
  if (stripped === '') { rmSync(layout.instructions, { force: true }); removed.push(layout.instructions); }
  else writeFileSync(layout.instructions, `${stripped}\n`);
  rmSync(`${layout.instructions}${BACKUP_SUFFIX}`, { force: true });
  return { removed };
}

/** The always-on summary claude-dev-team asked people to paste into `~/.claude/CLAUDE.md`. Its
 * rules now live inside the Client Mode section, and two copies of an operating model that
 * disagree on delegation are worse than one. It is moved into the install record, not deleted. */
const LEGACY_HEADINGS = ['# Operating mode — tech-lead orchestrator (claude-dev-team)'];

export type MovedSection = { file: string; text: string };

export function migrateLegacyInstructions(layout: HostLayout): MovedSection[] {
  if (layout.host !== 'claude' || !existsSync(layout.instructions)) return [];
  const original = readFileSync(layout.instructions, 'utf8');
  const lines = original.split('\n');
  const start = lines.findIndex(line => LEGACY_HEADINGS.includes(line.trim()));
  if (start === -1) return [];
  // The section runs to the next top-level heading or the end of the file.
  let end = lines.findIndex((line, index) => index > start && /^# /.test(line));
  if (end === -1) end = lines.length;
  const text = lines.slice(start, end).join('\n');
  const remaining = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  writeFileSync(layout.instructions, `${remaining}\n`);
  return [{ file: layout.instructions, text }];
}

export function restoreLegacyInstructions(moved: MovedSection[]): void {
  for (const section of moved) {
    const current = existsSync(section.file) ? readFileSync(section.file, 'utf8').trimEnd() : '';
    if (current.includes(section.text.trim())) continue;
    writeFileSync(section.file, current === '' ? `${section.text.trimEnd()}\n` : `${current}\n\n${section.text.trimEnd()}\n`);
  }
}
