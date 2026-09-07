/** Ingestion: the upload boundary.
 *
 * An upload returns an identity, not a verdict. The bytes are stored immutably with a digest;
 * the media type is decided from the bytes and their container parts, never from the filename;
 * and the container limits are checked before anything is decompressed. `INGESTED` means the
 * safety path passed, and nothing more — not that a page was read, not that a claim in the
 * document is true.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Attachment, DocumentVersion } from '../../../contracts/interfaces.js';
import { digest as canonicalDigest } from '../../contracts/src/canonical.js';
import type { ControllerDatabase } from '../../state/src/database.js';
import { inspectContainer, memberNames, readMember, CONTAINER_LIMITS } from './zip.js';
import { sniffMediaType } from './image.js';

export class IngestError extends Error {
  constructor(public readonly code: string, subject = '') {
    super(subject === '' ? code : `${code}: ${subject}`);
    this.name = 'IngestError';
  }
}

export type DocumentFormat = DocumentVersion['format'];

/** The declared per-file limits from DOCUMENT_WORKFLOW.md section 3. A trusted operator may
 * change them; document text never can. */
export const FILE_LIMITS: Record<string, number> = {
  'application/pdf': 25 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 25 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 25 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 25 * 1024 * 1024,
  'text/csv': 25 * 1024 * 1024,
  'text/tab-separated-values': 25 * 1024 * 1024,
  'image/png': 10 * 1024 * 1024,
  'image/jpeg': 10 * 1024 * 1024,
  'image/webp': 10 * 1024 * 1024,
  'text/plain': 1024 * 1024,
  'text/markdown': 1024 * 1024,
  'application/json': 1024 * 1024,
};

const FORMAT_OF: Record<string, DocumentFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image',
  'text/plain': 'text', 'text/markdown': 'text', 'application/json': 'text',
};

/** The OOXML container's own parts say which document it is. An extension does not. */
export function ooxmlMediaType(bytes: Buffer): string | null {
  let names: string[];
  try { names = memberNames(bytes); } catch { return null; }
  if (names.some(name => name.startsWith('word/'))) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (names.some(name => name.startsWith('xl/'))) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (names.some(name => name.startsWith('ppt/'))) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return null;
}

export type SafetyReport = {
  media_type_from_bytes: string | null;
  declared_media_type: string;
  mismatch: boolean;
  container: ReturnType<typeof inspectContainer> | null;
  /** Active content found and disabled. Finding it is the point; running it never happens. */
  active_content: string[];
  /** External targets that would run or load something: a remote template, an OLE object, a
   * sub-document. These refuse the upload. */
  external_references: string[];
  /** External targets that are data: a linked workbook. These do not refuse the upload — the
   * link is disabled, and any calculation depending on it is UNVERIFIED rather than guessed. */
  disabled_external_links: string[];
  refusals: string[];
  passed: boolean;
};

/** Relationship types that load or run something when the document is opened. */
const ACTIVATION_RELATIONSHIP = /(attachedTemplate|oleObject|subDocument|package|frame|aFChunk)/i;

const ACTIVE_PART = /(vbaProject\.bin|\.bin$|\/macros?\/|activeX)/i;

export function inspectSafety(input: { bytes: Buffer; declared_media_type: string }): SafetyReport {
  const refusals: string[] = [];
  const sniffed = sniffMediaType(input.bytes);
  let media_type_from_bytes = sniffed;
  let container: ReturnType<typeof inspectContainer> | null = null;
  const active_content: string[] = [];
  const external_references: string[] = [];
  const disabled_external_links: string[] = [];

  if (sniffed === 'application/zip') {
    container = inspectContainer(input.bytes, CONTAINER_LIMITS);
    refusals.push(...container.refusals);
    media_type_from_bytes = ooxmlMediaType(input.bytes);
    if (media_type_from_bytes === null) refusals.push('ZIP_IS_NOT_AN_OOXML_PACKAGE');
    for (const member of container.members) {
      if (ACTIVE_PART.test(member.name)) active_content.push(member.name);
    }
    // Relationship parts are read as text and scanned for external targets. They are never
    // fetched: a remote template is a finding, not something to go and get.
    for (const member of container.members.filter(entry => entry.name.endsWith('.rels'))) {
      try {
        const xml = readMember(input.bytes, member.name).toString('utf8');
        for (const match of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
          const tag = match[0];
          if (!/TargetMode="External"/.test(tag)) continue;
          const target = /Target="([^"]+)"/.exec(tag)?.[1];
          if (target === undefined) continue;
          const type = /Type="([^"]+)"/.exec(tag)?.[1] ?? '';
          (ACTIVATION_RELATIONSHIP.test(type) ? external_references : disabled_external_links).push(target);
        }
      } catch { refusals.push(`UNREADABLE_PART:${member.name}`); }
    }
  }
  if (sniffed === 'application/x-ole-storage') refusals.push('LEGACY_OLE_FORMAT_NOT_ACCEPTED_AS_OOXML');
  if (media_type_from_bytes === null && /^(text\/|application\/json)/.test(input.declared_media_type)) {
    // Text has no signature. It is accepted as text only if it decodes and carries no NUL.
    media_type_from_bytes = input.bytes.includes(0) ? null : input.declared_media_type;
    if (media_type_from_bytes === null) refusals.push('BINARY_CONTENT_DECLARED_AS_TEXT');
  }
  const mismatch = media_type_from_bytes !== null && media_type_from_bytes !== input.declared_media_type;
  if (mismatch) refusals.push(`MEDIA_TYPE_MISMATCH:declared=${input.declared_media_type}:bytes=${String(media_type_from_bytes)}`);
  if (media_type_from_bytes === null) refusals.push('MEDIA_TYPE_NOT_ESTABLISHED_FROM_BYTES');
  const limit = FILE_LIMITS[input.declared_media_type];
  if (limit === undefined) refusals.push(`UNSUPPORTED_MEDIA_TYPE:${input.declared_media_type}`);
  else if (input.bytes.byteLength > limit) refusals.push(`FILE_TOO_LARGE:${input.bytes.byteLength}>${limit}`);
  if (active_content.length > 0) refusals.push(`ACTIVE_CONTENT_PRESENT:${active_content.join(',')}`);
  if (external_references.length > 0) refusals.push(`ACTIVATING_EXTERNAL_REFERENCE:${external_references.join(',')}`);

  return {
    media_type_from_bytes, declared_media_type: input.declared_media_type, mismatch, container,
    active_content, external_references, disabled_external_links,
    refusals: [...new Set(refusals)], passed: refusals.length === 0,
  };
}

export const PIPELINE_DIGEST = canonicalDigest({
  ingest: '1.0.0', container_limits: CONTAINER_LIMITS, file_limits: FILE_LIMITS,
});

export type UploadOutcome =
  | { stored: true; attachment: Attachment; version: DocumentVersion; safety: SafetyReport; replayed: boolean }
  | { stored: false; safety: SafetyReport; version: DocumentVersion | null; reason: string };

export class DocumentStore {
  readonly #db: ControllerDatabase;
  readonly #root: string;
  readonly #now: () => string;

  constructor(db: ControllerDatabase, options: { blob_root: string; clock?: () => string }) {
    this.#db = db;
    this.#root = options.blob_root;
    this.#now = options.clock ?? (() => new Date().toISOString());
    mkdirSync(this.#root, { recursive: true });
  }

  /** Idempotent by (project, key). A retry after an interrupted parse returns the same source
   * identity rather than creating a second one. */
  upload(input: {
    project_id: string; declared_media_type: string; bytes: Buffer;
    privacy_class: string; idempotency_key: string; document_id?: string;
  }): UploadOutcome {
    const safety = inspectSafety({ bytes: input.bytes, declared_media_type: input.declared_media_type });
    const content_digest = `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`;
    const format = FORMAT_OF[input.declared_media_type] ?? 'text';
    const at = this.#now();

    const existing = this.#db.get('SELECT * FROM attachments WHERE project_id = ? AND idempotency_key = ?',
      input.project_id, input.idempotency_key);
    if (existing !== undefined) {
      if (String(existing['content_digest']) !== content_digest) {
        return { stored: false, safety, version: null, reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BYTES' };
      }
      const row = this.#db.get('SELECT * FROM document_versions WHERE project_id = ? AND attachment_id = ?',
        input.project_id, String(existing['attachment_id']));
      return {
        stored: true, replayed: true, safety,
        attachment: this.#attachmentOf(existing),
        version: JSON.parse(String(row?.['record_json'] ?? '{}')) as DocumentVersion,
      };
    }

    const attachment_id = `att_${randomUUID()}`;
    const version_id = `ver_${randomUUID()}`;
    const document_id = input.document_id ?? `doc_${randomUUID()}`;
    const storage_ref = path.join(this.#root, `${attachment_id}.bin`);
    const ingestion_status: DocumentVersion['ingestion_status'] =
      safety.passed ? 'INGESTED'
        : safety.refusals.some(reason => reason.startsWith('UNSUPPORTED_MEDIA_TYPE')) ? 'UNSUPPORTED' : 'BLOCKED';
    const version: DocumentVersion = {
      kind: 'document_version', schema_version: 1, version_id, document_id,
      project_id: input.project_id, attachment_id, content_digest, format,
      ingestion_status, safety_status: safety.passed ? 'PASSED' : 'FAILED',
      pipeline_digest: PIPELINE_DIGEST, created_at: at,
    };
    const attachment: Attachment = {
      kind: 'attachment', schema_version: 1, attachment_id, project_id: input.project_id,
      media_type: input.declared_media_type as Attachment['media_type'],
      byte_length: input.bytes.byteLength, content_digest,
      privacy_class: input.privacy_class as Attachment['privacy_class'], created_at: at,
    };

    return this.#db.transaction(() => {
      // The bytes are written before the row, and never rewritten: a version is immutable.
      writeFileSync(storage_ref, input.bytes);
      this.#db.run(`INSERT INTO attachments (attachment_id, project_id, media_type, byte_length, content_digest,
        privacy_class, storage_ref, idempotency_key, access_revoked_at, created_at) VALUES (?,?,?,?,?,?,?,?,NULL,?)`,
        attachment_id, input.project_id, input.declared_media_type, input.bytes.byteLength, content_digest,
        input.privacy_class, storage_ref, input.idempotency_key, at);
      this.#db.run(`INSERT INTO document_versions (version_id, project_id, document_id, attachment_id,
        content_digest, format, ingestion_status, safety_status, record_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        version_id, input.project_id, document_id, attachment_id, content_digest, format,
        ingestion_status, version.safety_status, JSON.stringify(version), at);
      return safety.passed
        ? { stored: true as const, replayed: false, attachment, version, safety }
        : { stored: false as const, safety, version, reason: safety.refusals[0] ?? 'BLOCKED' };
    });
  }

  #attachmentOf(row: Record<string, unknown>): Attachment {
    return {
      kind: 'attachment', schema_version: 1,
      attachment_id: String(row['attachment_id']), project_id: String(row['project_id']),
      media_type: String(row['media_type']) as Attachment['media_type'],
      byte_length: Number(row['byte_length']), content_digest: String(row['content_digest']),
      privacy_class: String(row['privacy_class']) as Attachment['privacy_class'],
      created_at: String(row['created_at']),
    };
  }

  /** Reads the bytes back, scoped to a project. There is no call that returns another
   * project's bytes, and a revoked attachment is refused even though the bytes still exist. */
  read(input: { project_id: string; version_id: string }): Buffer {
    const row = this.#db.get(`SELECT a.storage_ref AS storage_ref, a.access_revoked_at AS revoked, v.content_digest AS content_digest
      FROM document_versions v JOIN attachments a ON a.attachment_id = v.attachment_id
      WHERE v.project_id = ? AND v.version_id = ?`, input.project_id, input.version_id);
    if (row === undefined) throw new IngestError('VERSION_NOT_FOUND_IN_PROJECT', input.version_id);
    if (row['revoked'] !== null) throw new IngestError('ACCESS_REVOKED', input.version_id);
    const bytes = readFileSync(String(row['storage_ref']));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== String(row['content_digest'])) throw new IngestError('STORED_BYTES_CHANGED', input.version_id);
    return bytes;
  }

  revokeAccess(input: { project_id: string; attachment_id: string; at: string }): void {
    this.#db.run('UPDATE attachments SET access_revoked_at = ? WHERE project_id = ? AND attachment_id = ?',
      input.at, input.project_id, input.attachment_id);
  }

  versions(project_id: string): DocumentVersion[] {
    return this.#db.all('SELECT record_json FROM document_versions WHERE project_id = ? ORDER BY created_at', project_id)
      .map(row => JSON.parse(String(row['record_json'])) as DocumentVersion);
  }
}
