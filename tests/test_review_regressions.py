"""v1.2 audit regressions: schema, API design, and real SQLite constraints.
These do not exercise a live controller, provider, client browser, or OS sandbox.
"""
from pathlib import Path
from copy import deepcopy
import json
import sqlite3
import unittest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
NOW = '2026-09-07T00:00:00Z'
SCHEMA = json.loads((ROOT/'contracts/domain.schema.json').read_text())
API = json.loads((ROOT/'contracts/api.openapi.json').read_text())
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
def example(name):
    return json.loads((ROOT/f'contracts/examples/{name}.json').read_text())

class SchemaReviewTests(unittest.TestCase):
    def test_running_run_requires_contract(self):
        x=example('run');x.update(contract_id=None,requirements_revision=0,state='RUNNING')
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_scoped_contract_requires_positive_revision(self):
        x=example('run');x.update(requirements_revision=0,state='SCOPED')
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_ready_run_requires_candidate(self):
        x=example('run');x.update(candidate_id=None,state='READY_FOR_REVIEW')
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_precontract_blocked_is_representable(self):
        x=example('run');x.update(contract_id=None,requirements_revision=0,state='BLOCKED')
        self.assertTrue(VALIDATOR.is_valid(x))
    def test_deploy_approval_requires_candidate_and_artifact(self):
        x=example('approval');x.update(action='deploy',candidate_id=None,artifact_digest=None)
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_spend_approval_requires_positive_limit(self):
        x=example('approval');x.update(action='api_spend',maximum_spend_usd=None)
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_approve_decision_requires_grant(self):
        x=example('approval-decision');x.update(decision='approve',approval=None)
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_denial_cannot_contain_grant(self):
        x=example('approval-decision');x.update(decision='deny',approval=example('approval'))
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_zero_test_behavioral_policy_rejected(self):
        x=example('policy');x['checks'][0]['minimum_tests']=0
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_all_optional_policy_rejected(self):
        x=example('policy')
        for c in x['checks']:c['required']=False
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_text_requirements_attachment_supported(self):
        x=example('attachment');x.update(media_type='text/plain',byte_length=512)
        self.assertTrue(VALIDATOR.is_valid(x))
    def test_text_requirements_size_limit(self):
        x=example('attachment');x.update(media_type='text/plain',byte_length=1048577)
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_readonly_reviewer_has_no_write_scope(self):
        x=example('attempt');x.update(role='reviewer',allowed_write_paths=['src/'])
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_root_cannot_claim_parent(self):
        x=example('attempt');x.update(depth=0,parent_attempt_id='parent_01')
        self.assertFalse(VALIDATOR.is_valid(x))
    def test_child_requires_parent(self):
        x=example('attempt');x.update(depth=1,parent_attempt_id=None)
        self.assertFalse(VALIDATOR.is_valid(x))

class APIReviewTests(unittest.TestCase):
    def test_structured_question_route(self):
        self.assertIn('/v1/runs/{run_id}/questions',API['paths'])
    def test_client_answer_route_is_not_a_worker_privilege(self):
        op=API['paths'].get('/v1/questions/{question_id}/answer',{}).get('post',{})
        self.assertEqual(op.get('security'),[{'clientSession':[]}])
    def test_active_message_does_not_require_candidate(self):
        op=API['paths'].get('/v1/runs/{run_id}/messages',{}).get('post',{})
        self.assertEqual(op.get('operationId'),'submitRunMessage')
    def test_validation_status_matches_operations_document(self):
        for path,item in API['paths'].items():
            for method,op in item.items():
                if isinstance(op,dict) and 'requestBody' in op:
                    self.assertIn('422',op['responses'],f'{method} {path}')

class DatabaseReviewTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript((ROOT/'contracts/storage/controller.sql').read_text())
        self.db.execute('INSERT INTO projects VALUES (?,?,?,?,?)',('p','root','discover','internal',NOW))
        self.db.execute('INSERT INTO contracts VALUES (?,?,?,?,?,?)',('c','p',1,'{}','digest',NOW))
        for rid in ('r','r2'):
            self.db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                (rid,'p','c',1,'SCOPED',1,rid,'digest',None,'mock',NOW,NOW))
    def tearDown(self):self.db.close()
    def attempt(self,aid='a',rid='r'):
        self.db.execute('INSERT INTO task_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (aid,'p',rid,'task',1,'writer',None,0,'ws','[]','[]','digest',1,NOW,None,'RUNNING'))
    def test_unscoped_run_cannot_reference_missing_project(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                ('orphan','missing',None,0,'RECEIVED',0,'k','digest',None,'mock',NOW,NOW))
    def test_precontract_block_and_cancel_are_persistable(self):
        self.db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            ('new','p',None,0,'RECEIVED',0,'new','digest',None,'mock',NOW,NOW))
        self.db.execute("UPDATE runs SET state='BLOCKED' WHERE run_id='new'")
        self.db.execute("UPDATE runs SET state='CANCELLED' WHERE run_id='new'")
        self.assertEqual(self.db.execute("SELECT state FROM runs WHERE run_id='new'").fetchone()[0],'CANCELLED')
    def test_budget_cannot_attach_another_runs_attempt(self):
        self.attempt()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO budget_reservations VALUES (?,?,?,?,?,?,?,?)',
                ('b','r2','a',100,None,0,'RESERVED',NOW))
    def test_usage_cannot_attach_another_runs_attempt(self):
        self.attempt()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO usage_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                ('u','event','mock','native_account','p','r2','a',1,1,None,None,0,1,NOW))
    def test_run_cannot_point_to_another_runs_candidate(self):
        self.db.execute('INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?)',
            ('candidate','p','r','s','a',1,'pol','env',NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE runs SET candidate_id='candidate' WHERE run_id='r2'")
    def test_ready_requires_candidate(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE runs SET state='READY_FOR_REVIEW' WHERE run_id='r'")


class ValidationDependencyTests(unittest.TestCase):
    def test_missing_schema_dependency_cannot_report_pass(self):
        import subprocess,sys
        result=subprocess.run([sys.executable,'-S',str(ROOT/'scripts/check_handoff.py')],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertNotEqual(json.loads(result.stdout)['status'],'PASS')

if __name__=='__main__':unittest.main()
