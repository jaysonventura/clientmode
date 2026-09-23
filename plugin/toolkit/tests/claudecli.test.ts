import { describe, expect, it } from 'vitest';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { claudeEnhance } from '../src/llm/claudecli.js';
import { cfg, tmpRoot } from './helpers.js';

// The enhancer runs `claude -p` in the person's project. Under -p the host loads a project's
// .mcp.json servers without asking (docs: mcp#project-scope), and denying mcp__* tools does not stop
// the server process from starting. --strict-mcp-config does.
describe('claudeEnhance', () => {
  it('never starts the MCP servers a project defines', () => {
    const dir = tmpRoot();
    const log = path.join(dir, 'argv.txt');
    const fake = path.join(dir, 'claude');
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\necho suggestion\n`);
    chmodSync(fake, 0o755);
    claudeEnhance('make the login page faster', cfg(), fake);
    expect(readFileSync(log, 'utf8').split('\n')).toContain('--strict-mcp-config');
  });
});
