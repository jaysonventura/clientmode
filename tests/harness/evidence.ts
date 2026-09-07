/** Shared scenario fixtures: a deterministic clock and a retained-evidence writer.
 * Evidence is written under qa/product/<task>/ so a reviewer reads the real outputs,
 * not a summary of them.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

/** Monotonic test clock. Real durations are never inferred from it. */
export function fixedClock(start: string, stepMs = 1000): () => string {
  let current = Date.parse(start);
  if (!Number.isFinite(current)) throw new Error('INVALID_CLOCK_START');
  return () => {
    const value = new Date(current).toISOString();
    current += stepMs;
    return value;
  };
}

export class Evidence {
  readonly #dir: string;
  readonly paths: string[] = [];
  private constructor(dir: string) { this.#dir = dir; }

  static async open(task: string): Promise<Evidence> {
    const dir = path.join(ROOT, 'qa/product', task);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    return new Evidence(dir);
  }

  async write(name: string, body: unknown): Promise<string> {
    const file = path.join(this.#dir, name);
    await writeFile(file, JSON.stringify(body, null, 2) + '\n');
    const relative = path.relative(ROOT, file);
    this.paths.push(relative);
    return relative;
  }
}

/** Record what an operation actually did, including the failures. */
export function attempt<T>(action: () => T): { ok: true; value: T } | { ok: false; code: string; message: string } {
  try {
    return { ok: true, value: action() };
  } catch (error) {
    const failure = error as { code?: string; message: string };
    return { ok: false, code: failure.code ?? failure.constructor?.name ?? 'ERROR', message: failure.message };
  }
}

export async function attemptAsync<T>(action: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string; message: string }> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    const failure = error as { code?: string; message: string };
    return { ok: false, code: failure.code ?? failure.constructor?.name ?? 'ERROR', message: failure.message };
  }
}
