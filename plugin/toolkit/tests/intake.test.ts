import { describe, expect, it } from 'vitest';
import { intake } from '../src/prompt/intake.js';

describe('intake', () => {
  // Claude Code delivers background-task completions through UserPromptSubmit; they are not a person's
  // request, and routing one produced "Suggested agents: frontend-engineer, qa-engineer" (2026-09-23).
  it('marks a background-task notification as a harness event', () => {
    const raw =
      '<task-notification>\n<task-id>b15htlmgz</task-id>\n<status>completed</status>\n' +
      '<summary>Background command "Run root test suite" completed (exit code 0)</summary>\n</task-notification>';
    expect(intake(raw).isHarnessEvent).toBe(true);
  });

  it('treats an ordinary request as a person\'s prompt', () => {
    expect(intake('Add a task-notification badge to the header').isHarnessEvent).toBe(false);
  });
});
