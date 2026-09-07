/** Controller-owned probe artifact store.
 *
 * Screenshots, logs and probe results are written here by the probe process, content
 * addressed, and never inside the candidate workspace. A candidate cannot write a result
 * into this store, so a `pass.json` it produces is not evidence of anything.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Artifact = { artifact_id: string; media_type: string; byte_length: number; path: string };

export class ArtifactStore {
  readonly root: string;
  readonly #artifacts: Artifact[] = [];

  constructor(root: string) {
    this.root = path.resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  put(bytes: Buffer | string, media_type: string, suffix: string): Artifact {
    const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
    const artifact_id = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
    const file = path.join(this.root, `${artifact_id.slice(7)}${suffix}`);
    writeFileSync(file, buffer);
    const artifact = { artifact_id, media_type, byte_length: buffer.byteLength, path: file };
    this.#artifacts.push(artifact);
    return artifact;
  }

  list(): Artifact[] { return [...this.#artifacts]; }
}
