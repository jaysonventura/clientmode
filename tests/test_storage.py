"""Narrow SQL reference constraints. These do not implement service authorization."""
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
NOW = '2026-09-07T00:00:00Z'

class StorageReferenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'state.sqlite'
        self.db = sqlite3.connect(self.path)
        self.db.executescript((ROOT/'contracts/storage/controller.sql').read_text())
        self.db.execute('INSERT INTO projects VALUES (?,?,?,?,?)',('p','root','web','internal',NOW))
        self.db.execute('INSERT INTO contracts VALUES (?,?,?,?,?,?)',('c','p',1,'{}','digest',NOW))
        self.insert_run('r','key')
        self.db.commit()
    def tearDown(self):
        self.db.close()
        self.directory.cleanup()
    def insert_run(self, rid, key):
        self.db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            (rid,'p','c',1,'SCOPED',1,key,'digest',None,'mock',NOW,NOW))
    def test_unscoped_received_request_can_be_acknowledged(self):
        self.db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            ('new','p',None,0,'RECEIVED',0,'new-key','digest',None,'mock',NOW,NOW))
        self.db.commit()
        self.assertEqual(self.db.execute("SELECT contract_id FROM runs WHERE run_id='new'").fetchone()[0],None)
    def test_running_requires_linked_contract(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                ('bad','p',None,0,'RUNNING',0,'bad-key','digest',None,'mock',NOW,NOW))
    def test_duplicate_idempotency_key_is_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError): self.insert_run('r2','key')
    def test_invalid_state_is_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute("UPDATE runs SET state='VERY_DONE'")
    def test_contract_revision_requires_real_contract(self):
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('UPDATE runs SET requirements_revision=2')
    def test_compare_and_swap_has_one_winner(self):
        sql="UPDATE runs SET state='RUNNING',state_version=state_version+1 WHERE run_id='r' AND state_version=1"
        self.assertEqual(self.db.execute(sql).rowcount,1)
        self.assertEqual(self.db.execute(sql).rowcount,0)
    def test_commit_survives_reopen(self):
        self.db.close(); self.db=sqlite3.connect(self.path)
        self.assertEqual(self.db.execute('SELECT run_id FROM runs').fetchall(),[('r',)])
    def test_transaction_rolls_back_state_and_event(self):
        self.db.execute('BEGIN')
        self.db.execute("UPDATE runs SET state='RUNNING'")
        self.db.execute('INSERT INTO events VALUES (?,?,?,?,?,?)',('r',1,'e','transition','{}',NOW))
        self.db.rollback()
        self.assertEqual(self.db.execute('SELECT state FROM runs').fetchone()[0],'SCOPED')
        self.assertEqual(self.db.execute('SELECT count(*) FROM events').fetchone()[0],0)
    def test_sequence_duplicate_rejected(self):
        self.db.execute('INSERT INTO events VALUES (?,?,?,?,?,?)',('r',1,'e','transition','{}',NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO events VALUES (?,?,?,?,?,?)',('r',1,'e2','transition','{}',NOW))
    def test_cross_project_candidate_rejected(self):
        self.db.execute('INSERT INTO projects VALUES (?,?,?,?,?)',('other','root2','web','internal',NOW))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?)',
                ('cand','other','r','s','a',1,'p','env',NOW))
    def test_additional_authority_schemas_parse(self):
        for name in ['verifier','release']:
            with sqlite3.connect(':memory:') as db:
                db.executescript((ROOT/f'contracts/storage/{name}.sql').read_text())
                self.assertGreater(db.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0],2)
    def test_outbox_idempotency_constraint(self):
        args=('o','r','dispatch','op-key','{}','PENDING',0,NOW)
        self.db.execute('INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?)',args)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?)',('o2',)+args[1:])

if __name__ == '__main__': unittest.main()
