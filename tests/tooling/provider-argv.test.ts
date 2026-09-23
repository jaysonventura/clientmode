/** Headless workers run `claude -p`, where the host loads a project's `.mcp.json` servers without
 * asking (code.claude.com/docs/en/mcp: "In `claude -p` runs ... it loads project-scoped servers
 * without asking"). A client repository must not be able to start its own MCP servers inside a
 * Client Mode worker, so the adapter passes `--strict-mcp-config` and only the servers it was given.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAdapter } from '../../packages/providers/src/claude.js';

const base = { executable: 'claude', trusted_roots: [], probes: [] };

test('a worker ignores the MCP servers a client repository defines', () => {
  const argv = new ClaudeAdapter(base).argvFor({ prompt: 'x' });
  assert.ok(argv.includes('--strict-mcp-config'), argv.join(' '));
  assert.ok(!argv.includes('--mcp-config'), 'no servers unless the task approved some');
});

test('only the MCP config the task approved is passed', () => {
  const argv = new ClaudeAdapter({ ...base, mcp_config: '/approved/mcp.json' }).argvFor({ prompt: 'x' });
  assert.ok(argv.includes('--strict-mcp-config'));
  assert.deepEqual(argv.slice(argv.indexOf('--mcp-config'), argv.indexOf('--mcp-config') + 2), ['--mcp-config', '/approved/mcp.json']);
});
