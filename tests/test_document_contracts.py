"""v1.3 metadata/contract regressions only: no parser, renderer or live agent is exercised."""
from pathlib import Path
from copy import deepcopy
import json, sqlite3, unittest
from jsonschema import Draft202012Validator, FormatChecker
ROOT=Path(__file__).resolve().parents[1]
S=json.loads((ROOT/'contracts/domain.schema.json').read_text())
V=Draft202012Validator(S,format_checker=FormatChecker())
NOW='2026-09-07T00:00:00Z'
H='sha256:'+'a'*64

def ex(name): return json.loads((ROOT/'contracts/examples'/f'{name}.json').read_text())
class DocumentContracts(unittest.TestCase):
    def test_supported_upload_formats(self):
        for media in ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/tab-separated-values']:
            with self.subTest(media=media):
                a=ex('attachment');a.update(media_type=media,byte_length=1024);self.assertTrue(V.is_valid(a))
    def test_office_file_limit(self):
        a=ex('attachment');a.update(media_type='application/pdf',byte_length=26214401);self.assertFalse(V.is_valid(a))
    def test_image_limit_is_not_relaxed(self):
        a=ex('attachment');a['byte_length']=10485761;self.assertFalse(V.is_valid(a))
    def test_macro_upload_is_not_whitelisted(self):
        a=ex('attachment');a['media_type']='application/vnd.ms-excel.sheet.macroEnabled.12';self.assertFalse(V.is_valid(a))
    def test_document_entities_have_examples(self):
        for name in ['document-version','document-job','document-scope','document-finding','document-result','document-question','document-answer','service-case']:
            with self.subTest(name=name):self.assertTrue(V.is_valid(ex(name)))
    def test_ready_document_requires_protected_result_reference(self):
        x=ex('document-job');x.update(state='READY',result_id=None);self.assertFalse(V.is_valid(x))
    def test_processing_job_does_not_require_software_run(self):
        x=ex('document-job');x.update(state='PROCESSING',software_run_id=None,result_id=None);self.assertTrue(V.is_valid(x))
    def test_analyze_requires_inputs(self):
        x=ex('document-job');x.update(operation='analyze',input_version_ids=[]);self.assertFalse(V.is_valid(x))
    def test_create_allows_no_input_file(self):
        x=ex('document-job');x.update(operation='create',input_version_ids=[]);self.assertTrue(V.is_valid(x))
    def test_duplicate_document_inputs_rejected(self):
        x=ex('document-job');x['input_version_ids']=['v1','v1'];self.assertFalse(V.is_valid(x))
    def test_job_revision_is_positive(self):
        x=ex('document-job');x['instruction_revision']=0;self.assertFalse(V.is_valid(x))
    def test_job_has_no_self_approval_field(self):
        x=ex('document-job');x['approved_by_agent']=True;self.assertFalse(V.is_valid(x))
    def test_scope_cannot_be_empty_for_source_analysis(self):
        x=ex('document-scope');x['units']=[];self.assertFalse(V.is_valid(x))
    def test_conflict_requires_both_locations(self):
        x=ex('document-finding');x['classification']='conflict';self.assertFalse(V.is_valid(x))
    def test_duplicate_conflict_citations_rejected(self):
        x=ex('document-finding');x.update(classification='conflict',citations=[x['citations'][0]]*2);self.assertFalse(V.is_valid(x))
    def test_create_scope_can_be_generated_not_fake_source(self):
        x=ex('document-scope');x.update(scope_mode='generated_output',source_version_ids=[],units=[]);self.assertTrue(V.is_valid(x))
    def test_source_scope_still_needs_source_versions(self):
        x=ex('document-scope');x['source_version_ids']=[];self.assertFalse(V.is_valid(x))
    def test_generated_scope_rejects_claimed_source_units(self):
        x=ex('document-scope');x['scope_mode']='generated_output';self.assertFalse(V.is_valid(x))
    def test_same_page_conflict_can_distinguish_actual_excerpts(self):
        x=ex('document-finding');a=deepcopy(x['citations'][0]);b=deepcopy(a)
        a['excerpt']='Cancel within 24 hours.';b['excerpt']='Cancel within 48 hours.'
        x.update(classification='conflict',citations=[a,b]);self.assertTrue(V.is_valid(x))
    def test_document_evidence_does_not_need_software_candidate(self):
        x=ex('document-evidence');self.assertNotIn('candidate_id',x);self.assertTrue(V.is_valid(x))
    def test_document_evidence_binds_source_scope(self):
        x=ex('document-evidence');del x['scope_digest'];self.assertFalse(V.is_valid(x))
    def test_document_evidence_binds_output_bytes(self):
        x=ex('document-evidence');del x['output_manifest_digest'];self.assertFalse(V.is_valid(x))
    def test_document_policy_requires_protected_authority(self):
        x=ex('document-policy');x['authority']='worker';self.assertFalse(V.is_valid(x))
    def test_document_policy_must_have_required_checks(self):
        x=ex('document-policy')
        for q in x['checks']:q['required']=False
        self.assertFalse(V.is_valid(x))
    def test_document_policy_has_positive_freshness(self):
        x=ex('document-policy');x['maximum_age_seconds']=0;self.assertFalse(V.is_valid(x))
    def test_document_evidence_requires_attempt_identity(self):
        x=ex('document-evidence');del x['attempt_id'];self.assertFalse(V.is_valid(x))
    def test_scope_digest_required(self):
        x=ex('document-scope');del x['scope_digest'];self.assertFalse(V.is_valid(x))
    def test_source_version_cannot_be_empty(self):
        x=ex('document-version');x['content_digest']='';self.assertFalse(V.is_valid(x))
    def test_ingested_version_requires_scan_pass(self):
        x=ex('document-version');x.update(ingestion_status='INGESTED',safety_status='UNVERIFIED');self.assertFalse(V.is_valid(x))
    def test_observation_requires_source(self):
        x=ex('document-finding');x.update(classification='observed',citations=[]);self.assertFalse(V.is_valid(x))
    def test_suggestion_may_be_explicitly_unsourced(self):
        x=ex('document-finding');x.update(classification='suggestion',citations=[]);self.assertTrue(V.is_valid(x))
    def test_pdf_citation_page_is_positive(self):
        x=ex('document-finding');x['citations'][0]['locator']['page_number']=0;self.assertFalse(V.is_valid(x))
    def test_citation_requires_content_version(self):
        x=ex('document-finding');del x['citations'][0]['version_id'];self.assertFalse(V.is_valid(x))
    def test_excel_citation_is_sheet_and_cell_specific(self):
        x=ex('document-finding');x['citations'][0]['locator']={'type':'sheet','sheet_name':'Prices','cell_range':'D2:D1501'};self.assertTrue(V.is_valid(x))
        del x['citations'][0]['locator']['sheet_name'];self.assertFalse(V.is_valid(x))
    def test_coverage_finding_cannot_be_silently_complete(self):
        x=ex('document-result');x.update(coverage='PARTIAL',limitations=[]);self.assertFalse(V.is_valid(x))
    def test_output_artifacts_required(self):
        x=ex('document-result');x['artifacts']=[];self.assertFalse(V.is_valid(x))
    def test_recalculation_unknown_not_recast_as_verified(self):
        x=ex('document-result');x['calculation_status']='probably-correct';self.assertFalse(V.is_valid(x))
    def test_document_question_is_not_software_run_bound(self):
        x=ex('document-question');self.assertNotIn('run_id',x);self.assertTrue(V.is_valid(x))
    def test_document_answer_requires_exact_question(self):
        x=ex('document-answer');del x['question_id'];self.assertFalse(V.is_valid(x))
    def test_scope_carries_an_explicit_visibility_boundary(self):
        x=ex('document-scope');del x['scope_mode'];self.assertFalse(V.is_valid(x))
    def test_service_case_not_a_fake_sla(self):
        x=ex('service-case');x['coverage_mode']='always-on-by-prompt';self.assertFalse(V.is_valid(x))

class DocumentAPI(unittest.TestCase):
    def setUp(self):self.api=json.loads((ROOT/'contracts/api.openapi.json').read_text())
    def test_analyze_request_without_sources_rejected(self):
        schema=self.api['paths']['/v1/projects/{project_id}/document-jobs']['post']['requestBody']['content']['application/json']['schema']
        self.assertFalse(Draft202012Validator(schema).is_valid({'request_id':'req','operation':'analyze','input_version_ids':[]}))
    def test_create_request_without_sources_allowed(self):
        schema=self.api['paths']['/v1/projects/{project_id}/document-jobs']['post']['requestBody']['content']['application/json']['schema']
        self.assertTrue(Draft202012Validator(schema).is_valid({'request_id':'req','operation':'create','input_version_ids':[]}))
    def test_document_answer_requires_revision_header(self):
        op=self.api['paths']['/v1/document-questions/{question_id}/answer']['post']
        self.assertTrue(next(p for p in op['parameters'] if p['name']=='If-Match')['required'])
    def test_document_job_create_route(self):self.assertIn('/v1/projects/{project_id}/document-jobs',self.api['paths'])
    def test_document_answer_requires_client(self):
        op=self.api['paths']['/v1/document-questions/{question_id}/answer']['post'];self.assertEqual(op['security'],[{'clientSession':[]}])
    def test_document_result_not_writable_by_worker(self):
        self.assertNotIn('post',self.api['paths']['/v1/document-results/{result_id}'])
    def test_version_download_is_separate_from_metadata(self):self.assertIn('/v1/document-results/{result_id}/artifacts/{artifact_id}',self.api['paths'])

class DocumentStorage(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.db.executescript((ROOT/'contracts/storage/controller.sql').read_text());self.db.executescript((ROOT/'contracts/storage/documents.sql').read_text())
        self.db.execute('INSERT INTO projects VALUES (?,?,?,?,?)',('p','root','discover','internal',NOW))
        self.db.execute('INSERT INTO projects VALUES (?,?,?,?,?)',('p2','other','discover','internal',NOW))
        self.db.execute('INSERT INTO client_requests VALUES (?,?,?,?,?,?,?)',('req','p','review','[]','en','internal',NOW))
    def tearDown(self):self.db.close()
    def seed(self):
        self.db.execute('INSERT INTO document_versions VALUES (?,?,?,?,?,?,?,?,?,?)',('v','p','doc','attachment',H,'pdf','INGESTED','PASSED','{}',NOW))
        self.db.execute('INSERT INTO document_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',('j','p','req','analyze','PROCESSING',0,1,None,None,'{}',NOW,NOW))
    def test_cross_project_source_binding_denied(self):
        self.seed()
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO document_job_sources VALUES (?,?,?)',('p2','j','v'))
    def test_document_source_version_is_immutable(self):
        self.seed()
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('UPDATE document_versions SET content_digest=? WHERE version_id=?',('new','v'))
    def test_question_only_one_open_per_job(self):
        self.seed();self.db.execute('INSERT INTO document_questions VALUES (?,?,?,?,?,?,?,?)',('q','p','j',1,'OPEN','{}',NOW,NOW))
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO document_questions VALUES (?,?,?,?,?,?,?,?)',('q2','p','j',1,'OPEN','{}',NOW,NOW))
    def test_document_job_can_be_persisted_without_git_run(self):
        self.seed();self.assertIsNone(self.db.execute('SELECT software_run_id FROM document_jobs').fetchone()[0])
    def test_answer_cannot_reference_wrong_job(self):
        self.seed();self.db.execute('INSERT INTO document_questions VALUES (?,?,?,?,?,?,?,?)',('q','p','j',1,'OPEN','{}',NOW,NOW))
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO document_answers VALUES (?,?,?,?,?,?,?)',('a','p','wrong','q','req','client',NOW))
    def test_ready_requires_result(self):
        self.seed()
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute("UPDATE document_jobs SET state='READY' WHERE job_id='j'")
    def test_duplicate_source_binding_rejected(self):
        self.seed();self.db.execute('INSERT INTO document_job_sources VALUES (?,?,?)',('p','j','v'))
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('INSERT INTO document_job_sources VALUES (?,?,?)',('p','j','v'))
if __name__=='__main__':unittest.main()

class DocumentProtectedStorage(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript((ROOT/'contracts/storage/verifier.sql').read_text())
        self.db.executescript((ROOT/'contracts/storage/document-verifier.sql').read_text())
    def tearDown(self):self.db.close()
    def test_document_verifier_has_separate_tables(self):
        rows={r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({'document_policy_versions','document_verification_jobs','document_check_executions','document_evidence_envelopes'}.issubset(rows))
    def test_document_execution_cannot_reference_unknown_job(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO document_evidence_envelopes VALUES (?,?,?,?,?,?,?)',('e','absent','issuer',H,'{}',H,NOW))
