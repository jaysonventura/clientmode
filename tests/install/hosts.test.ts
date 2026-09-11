/** Every host gets the same operating model, loaded from the place that host actually reads.
 *
 * Claude Code takes its skills from the `cm` plugin, so nothing is copied into `~/.claude/skills`.
 * Codex, Gemini CLI and Cursor all read `~/.agents/skills`, so the skills are written there once;
 * a copy in a second directory is a duplicate skill in Cursor, which reads several of them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOSTS, activateHost, deactivateHost, hostLayout, migrateLegacyInstructions, restoreLegacyInstructions, SKILLS_DIRECTORY } from '../../packages/packaging/src/hosts.js';
import { ROOT } from '../harness/evidence.js';

const home = (): string => mkdtempSync(path.join(tmpdir(), 'cm-hosts-'));
const sourceSkills = readdirSync(path.join(ROOT, SKILLS_DIRECTORY)).sort();

test('the four hosts load from their documented locations', () => {
  const h = '/home/u';
  assert.deepEqual(HOSTS, ['claude', 'codex', 'gemini', 'cursor']);
  assert.deepEqual(hostLayout('claude', h, {}), {
    host: 'claude', config_root: path.join(h, '.claude'), instructions: path.join(h, '.claude', 'CLAUDE.md'),
    instructions_kind: 'block', skills_root: null, skill_reference: 'cm:',
  });
  assert.equal(hostLayout('codex', h, {}).instructions, path.join(h, '.codex', 'AGENTS.md'));
  assert.equal(hostLayout('gemini', h, {}).instructions, path.join(h, '.gemini', 'GEMINI.md'));
  assert.equal(hostLayout('cursor', h, {}).instructions, path.join(h, '.cursor', 'rules', 'client-mode.mdc'));
  assert.equal(hostLayout('cursor', h, {}).instructions_kind, 'owned-file');
  for (const host of ['codex', 'gemini', 'cursor'] as const) {
    assert.equal(hostLayout(host, h, {}).skills_root, path.join(h, '.agents', 'skills'));
    assert.equal(hostLayout(host, h, {}).skill_reference, 'cm-');
  }
  // The hosts' own relocation variables are honoured, so a sandboxed host is configured in place.
  assert.equal(hostLayout('claude', h, { CLAUDE_CONFIG_DIR: '/x/claude' }).config_root, '/x/claude');
  assert.equal(hostLayout('codex', h, { CODEX_HOME: '/x/codex' }).instructions, path.join('/x/codex', 'AGENTS.md'));
  assert.equal(hostLayout('gemini', h, { GEMINI_CLI_HOME: '/x/g' }).config_root, path.join('/x/g', '.gemini'));
});

test('Claude gets the rules with plugin-namespaced skill names and no copied skills', () => {
  const h = home();
  const layout = hostLayout('claude', h, {});
  activateHost({ layout, source_root: ROOT, lead: true });
  const text = readFileSync(layout.instructions, 'utf8');
  assert.match(text, /<!-- client-mode:start -->/);
  assert.match(text, /## Test first, always/);
  assert.match(text, /`cm:tdd`/);
  assert.doesNotMatch(text, /`cm-tdd`/);
  assert.equal(existsSync(path.join(h, '.claude', 'skills')), false);
});

test('Codex, Gemini and Cursor share one skills directory with names that match their folders', () => {
  const h = home();
  for (const host of ['codex', 'gemini', 'cursor'] as const) activateHost({ layout: hostLayout(host, h, {}), source_root: ROOT, lead: true });
  const skillsRoot = path.join(h, '.agents', 'skills');
  const installed = readdirSync(skillsRoot).sort();
  assert.deepEqual(installed, sourceSkills.map(name => `cm-${name}`));
  for (const name of sourceSkills) {
    const body = readFileSync(path.join(skillsRoot, `cm-${name}`, 'SKILL.md'), 'utf8');
    assert.match(body, new RegExp(`^---\\nname: cm-${name}\\n`), `${name} frontmatter name matches its folder`);
  }
  // A skill is a directory, not a file: templates and references travel with it.
  assert.ok(existsSync(path.join(skillsRoot, 'cm-web-qa', 'templates')));
  assert.match(readFileSync(path.join(h, '.codex', 'AGENTS.md'), 'utf8'), /`cm-tdd`/);
  assert.match(readFileSync(path.join(h, '.gemini', 'GEMINI.md'), 'utf8'), /## Test first, always/);
  const rule = readFileSync(path.join(h, '.cursor', 'rules', 'client-mode.mdc'), 'utf8');
  assert.match(rule, /^---\n[\s\S]*alwaysApply: true[\s\S]*\n---\n/);
  assert.match(rule, /## Test first, always/);
  assert.equal(existsSync(path.join(h, '.codex', 'skills')), false, 'nothing in the deprecated Codex skills directory');
});

test('deactivation returns every instructions file to the bytes it had', () => {
  const h = home();
  const own = { claude: '# mine\n\nKeep this.\n', codex: 'codex notes\n', gemini: '# gemini\n' };
  for (const [host, body] of Object.entries(own)) {
    const layout = hostLayout(host as 'claude', h, {});
    mkdirSync(path.dirname(layout.instructions), { recursive: true });
    writeFileSync(layout.instructions, body);
  }
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const host of HOSTS) activateHost({ layout: hostLayout(host, h, {}), source_root: ROOT, lead: true });
    for (const host of HOSTS) deactivateHost({ layout: hostLayout(host, h, {}), remove_skills: true });
  }
  for (const [host, body] of Object.entries(own)) {
    assert.equal(readFileSync(hostLayout(host as 'claude', h, {}).instructions, 'utf8'), body, host);
  }
  assert.equal(existsSync(path.join(h, '.cursor', 'rules', 'client-mode.mdc')), false);
  assert.equal(existsSync(path.join(h, '.agents', 'skills')), false);
});

test('a skill the person wrote themselves is never removed', () => {
  const h = home();
  const mine = path.join(h, '.agents', 'skills', 'my-skill', 'SKILL.md');
  mkdirSync(path.dirname(mine), { recursive: true });
  writeFileSync(mine, '---\nname: my-skill\ndescription: mine\n---\n');
  activateHost({ layout: hostLayout('codex', h, {}), source_root: ROOT, lead: true });
  deactivateHost({ layout: hostLayout('codex', h, {}), remove_skills: true });
  assert.ok(existsSync(mine));
});

test('the old claude-dev-team section is moved out of CLAUDE.md and can be put back', () => {
  const h = home();
  const layout = hostLayout('claude', h, {});
  mkdirSync(path.dirname(layout.instructions), { recursive: true });
  const legacy = '# Operating mode — tech-lead orchestrator (claude-dev-team)\n\nYou operate as a tech-lead.\n\n## Prime directive\nTriage.\n';
  const original = `# My notes\n\nKeep.\n\n${legacy}`;
  writeFileSync(layout.instructions, original);
  const moved = migrateLegacyInstructions(layout);
  assert.equal(moved.length, 1);
  assert.equal(readFileSync(layout.instructions, 'utf8'), '# My notes\n\nKeep.\n');
  restoreLegacyInstructions(moved);
  assert.equal(readFileSync(layout.instructions, 'utf8'), original);
  // Nothing to migrate is not an error and changes nothing.
  assert.deepEqual(migrateLegacyInstructions(hostLayout('codex', h, {})), []);
});
