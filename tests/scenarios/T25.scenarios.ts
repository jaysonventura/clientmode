/** AT-025 executor — document ingestion boundary.
 *
 * Every file is uploaded through the real store, into a real SQLite database, with the real
 * container inspection in front of it. The canaries are inspected, not run: a macro part is a
 * finding, a remote template is a finding, and neither is ever fetched or executed.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Json, ScenarioObservation } from '../../contracts/interfaces.js';
import { validateEntity } from '../../packages/contracts/src/validate.js';
import { ControllerDatabase } from '../../packages/state/src/database.js';
import { LifecycleService } from '../../packages/core/src/lifecycle.js';
import { DocumentStore, inspectSafety } from '../../packages/documents/src/ingest.js';
import * as corpus from '../../fixtures/documents/corpus.js';
import { Evidence, attempt, fixedClock } from '../harness/evidence.js';
import { registerScenario } from '../harness/registry.js';

const PROJECT = 'project_t25';
const OTHER_PROJECT = 'project_t25_other';
const NOW = '2026-09-09T06:00:00.000Z';

registerScenario('AT-025', async (): Promise<ScenarioObservation> => {
  const writer = await Evidence.open('T25');
  const sandbox = mkdtempSync(path.join(tmpdir(), 'cm-t25-'));
  const db = ControllerDatabase.open(path.join(sandbox, 'state'));

  try {
    const service = new LifecycleService(db, { clock: fixedClock(NOW) });
    for (const project of [PROJECT, OTHER_PROJECT]) {
      service.registerProject({ project_id: project, registered_root_ref: `file://${sandbox}/${project}`, profile_id: 'discover', data_class: 'internal' });
    }
    const store = new DocumentStore(db, { blob_root: path.join(sandbox, 'blobs'), clock: fixedClock(NOW) });

    // 1. The seven approved format families, uploaded through the real store.
    const families: Array<[string, string, Buffer]> = [
      ['pdf', corpus.MEDIA_TYPES.pdf, corpus.pdfTerms()],
      ['docx', corpus.MEDIA_TYPES.docx, corpus.docxPolicy()],
      ['xlsx', corpus.MEDIA_TYPES.xlsx, corpus.xlsxPricing()],
      ['pptx', corpus.MEDIA_TYPES.pptx, corpus.pptxDeck()],
      ['csv', corpus.MEDIA_TYPES.csv, corpus.csvOrders()],
      ['tsv', corpus.MEDIA_TYPES.tsv, corpus.tsvOrders()],
      ['png', corpus.MEDIA_TYPES.png, corpus.pngScreenshot()],
      ['markdown', corpus.MEDIA_TYPES.markdown, corpus.markdownBrief()],
      ['json', corpus.MEDIA_TYPES.json, corpus.jsonConfig()],
    ];
    const stored = families.map(([label, media_type, bytes]) => {
      const outcome = store.upload({
        project_id: PROJECT, declared_media_type: media_type, bytes,
        privacy_class: 'internal', idempotency_key: `upload-${label}`,
      });
      const expected = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      return {
        label, media_type, byte_length: bytes.byteLength, expected_digest: expected,
        stored: outcome.stored,
        recorded_digest: outcome.stored ? outcome.version.content_digest : null,
        ingestion_status: outcome.stored ? outcome.version.ingestion_status : outcome.version?.ingestion_status ?? null,
        safety_status: outcome.stored ? outcome.version.safety_status : outcome.version?.safety_status ?? null,
        version_id: outcome.stored ? outcome.version.version_id : null,
        refusals: outcome.safety.refusals,
        schema_valid: outcome.stored ? validateEntity(outcome.version).valid && validateEntity(outcome.attachment).valid : false,
        // The bytes come back byte-identical from storage, not from the caller's copy.
        round_trip_identical: outcome.stored
          ? store.read({ project_id: PROJECT, version_id: outcome.version.version_id }).equals(bytes) : false,
      };
    });
    const allStored = stored.every(entry => entry.stored && entry.recorded_digest === entry.expected_digest &&
      entry.round_trip_identical && entry.schema_valid && entry.ingestion_status === 'INGESTED');

    // An INGESTED status is a safety result, never an analysis result. Nothing in the record
    // claims a page was read.
    const ingestedRecord = JSON.parse(JSON.stringify(stored[0])) as Record<string, unknown>;
    const uploadNotAnalysis = stored.every(entry => entry.ingestion_status === 'INGESTED') &&
      !JSON.stringify(stored).includes('"analysis') &&
      db.get('SELECT COUNT(*) AS n FROM document_scopes')?.['n'] === 0 &&
      db.get('SELECT COUNT(*) AS n FROM document_results')?.['n'] === 0 &&
      db.get('SELECT COUNT(*) AS n FROM document_jobs')?.['n'] === 0;

    // 2. Canaries. Each one is inspected; none is activated.
    const canaries = {
      macro_and_remote_template: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.docx,
        bytes: corpus.docxWithMacroAndRemoteTemplate(), privacy_class: 'internal', idempotency_key: 'canary-macro',
      }),
      forged_type: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.docx,
        bytes: corpus.forgedType(), privacy_class: 'internal', idempotency_key: 'canary-forged',
      }),
      legacy_ole: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.docx,
        bytes: corpus.legacyOle(), privacy_class: 'internal', idempotency_key: 'canary-ole',
      }),
      zip_bomb: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.docx,
        bytes: corpus.zipBomb(), privacy_class: 'internal', idempotency_key: 'canary-bomb',
      }),
      traversal: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.docx,
        bytes: corpus.zipTraversal(), privacy_class: 'internal', idempotency_key: 'canary-traversal',
      }),
      absolute_path: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.docx,
        bytes: corpus.zipAbsolutePath(), privacy_class: 'internal', idempotency_key: 'canary-absolute',
      }),
      too_many_members: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.docx,
        bytes: corpus.zipManyMembers(), privacy_class: 'internal', idempotency_key: 'canary-members',
      }),
      oversized_text: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.markdown,
        bytes: Buffer.alloc(2 * 1024 * 1024, 0x61), privacy_class: 'internal', idempotency_key: 'canary-oversize',
      }),
      binary_as_text: store.upload({
        project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.text,
        bytes: Buffer.from([0x00, 0x01, 0x02, 0x03]), privacy_class: 'internal', idempotency_key: 'canary-binary',
      }),
    };
    const refusalsOf = (key: keyof typeof canaries): string[] => canaries[key].safety.refusals;
    const macroSafety = inspectSafety({ bytes: corpus.docxWithMacroAndRemoteTemplate(), declared_media_type: corpus.MEDIA_TYPES.docx });

    const macroBlocked = !canaries.macro_and_remote_template.stored &&
      macroSafety.active_content.some(part => /vbaProject\.bin$/.test(part)) &&
      macroSafety.external_references.includes('https://example.invalid/tracking-template.dotm') &&
      refusalsOf('macro_and_remote_template').some(reason => reason.startsWith('ACTIVE_CONTENT_PRESENT')) &&
      refusalsOf('macro_and_remote_template').some(reason => reason.startsWith('ACTIVATING_EXTERNAL_REFERENCE'));
    const forgedBlocked = !canaries.forged_type.stored &&
      refusalsOf('forged_type').some(reason => reason.startsWith('MEDIA_TYPE_MISMATCH')) &&
      !canaries.legacy_ole.stored &&
      refusalsOf('legacy_ole').includes('LEGACY_OLE_FORMAT_NOT_ACCEPTED_AS_OOXML');
    const limitsEnforced = !canaries.zip_bomb.stored && refusalsOf('zip_bomb').some(reason => reason.startsWith('COMPRESSION_RATIO')) &&
      !canaries.traversal.stored && refusalsOf('traversal').some(reason => reason.startsWith('PARENT_TRAVERSAL')) &&
      !canaries.absolute_path.stored && refusalsOf('absolute_path').some(reason => reason.startsWith('ABSOLUTE_PATH')) &&
      !canaries.too_many_members.stored && refusalsOf('too_many_members').some(reason => reason.startsWith('MEMBER_COUNT')) &&
      !canaries.oversized_text.stored && refusalsOf('oversized_text').some(reason => reason.startsWith('FILE_TOO_LARGE')) &&
      !canaries.binary_as_text.stored && refusalsOf('binary_as_text').includes('BINARY_CONTENT_DECLARED_AS_TEXT');

    // 3. Cross-project reads and cross-project version binding.
    const mine = stored.find(entry => entry.label === 'pdf')!;
    const theirs = store.upload({
      project_id: OTHER_PROJECT, declared_media_type: corpus.MEDIA_TYPES.pdf,
      bytes: corpus.pdfTerms(), privacy_class: 'internal', idempotency_key: 'other-upload',
    });
    const crossRead = attempt(() => store.read({ project_id: OTHER_PROJECT, version_id: mine.version_id! }));
    const ownRead = attempt(() => store.read({ project_id: PROJECT, version_id: mine.version_id! }));
    const revoked = (() => {
      const row = db.get('SELECT attachment_id FROM document_versions WHERE version_id = ?', mine.version_id!);
      store.revokeAccess({ project_id: PROJECT, attachment_id: String(row!['attachment_id']), at: NOW });
      const after = attempt(() => store.read({ project_id: PROJECT, version_id: mine.version_id! }));
      db.run('UPDATE attachments SET access_revoked_at = NULL WHERE attachment_id = ?', String(row!['attachment_id']));
      return after;
    })();
    const crossProjectDenied = !crossRead.ok && crossRead.message.includes('VERSION_NOT_FOUND_IN_PROJECT') &&
      ownRead.ok && !revoked.ok && revoked.message.includes('ACCESS_REVOKED') &&
      theirs.stored && theirs.version.project_id === OTHER_PROJECT;

    // 4. Interrupt and retry: the same idempotency key returns one source identity.
    const retry = store.upload({
      project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.pdf, bytes: corpus.pdfTerms(),
      privacy_class: 'internal', idempotency_key: 'upload-pdf',
    });
    const differentBytes = store.upload({
      project_id: PROJECT, declared_media_type: corpus.MEDIA_TYPES.pdf,
      bytes: Buffer.concat([corpus.pdfTerms(), Buffer.from('% edited\n')]),
      privacy_class: 'internal', idempotency_key: 'upload-pdf',
    });
    // A blocked upload still records a version, so the count that matters is of ingested
    // sources: the forged-type canary carries the same bytes and is deliberately among them.
    const identities = Number(db.get(
      "SELECT COUNT(*) AS n FROM document_versions WHERE project_id = ? AND content_digest = ? AND ingestion_status = 'INGESTED'",
      PROJECT, mine.expected_digest)?.['n'] ?? 0);
    const blockedWithSameBytes = Number(db.get(
      "SELECT COUNT(*) AS n FROM document_versions WHERE project_id = ? AND content_digest = ? AND ingestion_status <> 'INGESTED'",
      PROJECT, mine.expected_digest)?.['n'] ?? 0);
    const retryOneIdentity = retry.stored && retry.replayed && retry.version.version_id === mine.version_id &&
      identities === 1 && !differentBytes.stored &&
      (differentBytes.stored ? '' : differentBytes.reason) === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BYTES';

    await writer.write('ingestion.json', {
      stored, upload_is_not_analysis: { record: ingestedRecord, scopes: 0, results: 0, jobs: 0 },
      canaries: Object.fromEntries(Object.entries(canaries).map(([key, value]) => [key, {
        stored: value.stored, refusals: value.safety.refusals,
        active_content: value.safety.active_content, external_references: value.safety.external_references,
        disabled_external_links: value.safety.disabled_external_links,
        media_type_from_bytes: value.safety.media_type_from_bytes,
      }])),
      workbook_external_link_disabled_not_blocked: {
        stored: stored.find(entry => entry.label === 'xlsx')?.stored ?? false,
        disabled_links: inspectSafety({ bytes: corpus.xlsxPricing(), declared_media_type: corpus.MEDIA_TYPES.xlsx }).disabled_external_links,
      },
      cross_project: { read_other_project: crossRead, read_own: ownRead.ok, after_revocation: revoked },
      retry: {
        replayed: retry.stored && retry.replayed, ingested_identities: identities,
        blocked_versions_with_same_bytes: blockedWithSameBytes,
        different_bytes: differentBytes.stored ? null : differentBytes.reason,
      },
      container_limits_note: 'The macro part and the remote template are recorded as findings. Nothing was executed and no external target was fetched.',
    } as unknown as Json);
    await writer.write('safety-reports.json', { macro: macroSafety } as unknown as Json);

    return {
      scenario_id: 'AT-025',
      mode: 'integration',
      observed: {
        valid_files_stored_with_exact_digest: allStored && stored.length === 9,
        upload_not_misreported_as_analyzed: uploadNotAnalysis,
        macro_and_network_canaries_not_executed: macroBlocked && forgedBlocked,
        size_and_expansion_limits_enforced: limitsEnforced,
        cross_project_access_denied: crossProjectDenied,
        retry_preserves_one_source_identity: retryOneIdentity,
        formats_stored: stored.length,
        canaries_refused: Object.values(canaries).filter(outcome => !outcome.stored).length,
      } satisfies Record<string, Json>,
      artifact_paths: writer.paths,
    };
  } finally {
    db.close();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
