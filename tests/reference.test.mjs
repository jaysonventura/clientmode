import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync, sign} from 'node:crypto';
import {evaluateEnvelope, canTransition} from '../reference/acceptance.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`../contracts/examples/${name}.json`, import.meta.url), 'utf8'));
const {publicKey, privateKey} = generateKeyPairSync('ed25519');
const now = '2026-09-07T00:02:00Z';
function seal(evidence) {
  const payload = Buffer.from(JSON.stringify(evidence));
  return {kind:'signed_envelope', schema_version:1, issuer_id:'verifier_fixture', algorithm:'Ed25519',
    payload_base64:payload.toString('base64'), signature_base64:sign(null,payload,privateKey).toString('base64')};
}
function inputs() {
  return {candidate:fixture('candidate'),policy:fixture('policy'),envelope:seal(fixture('evidence')),
    trust:{verifier_fixture:{publicKey,revoked:false}},now,expectedAttemptId:'attempt_01'};
}
test('synthetic authentic current complete evidence is verified for scope only', () => {
  const result=evaluateEnvelope(inputs());
  assert.equal(result.verdict,'VERIFIED_FOR_SCOPE');
  assert.equal(result.candidate_id,'candidate_01');
  assert.equal(Object.hasOwn(result,'production_ready'),false);
});
const mutations = [
  ['missing evidence identity', e=>delete e.evidence_id],
  ['missing required result', e=>e.results.pop()],
  ['failed result', e=>e.results[0].status='FAILED'],
  ['nonzero exit', e=>e.results[0].exit_code=1],
  ['timeout', e=>e.results[0].status='TIMEOUT'],
  ['skipped status', e=>e.results[0].status='SKIPPED'],
  ['not executed', e=>e.results[0].executed=false],
  ['zero tests', e=>{e.results[0].tests_total=0;e.results[0].tests_passed=0;}],
  ['reduced test discovery', e=>{e.results[0].tests_total=2;e.results[0].tests_passed=2;}],
  ['skipped test', e=>e.results[0].tests_skipped=1],
  ['incomplete passing count', e=>e.results[0].tests_passed=1],
  ['negative count', e=>e.results[0].tests_total=-1],
  ['missing assertion', e=>e.results[0].assertion_ids.pop()],
  ['duplicate assertion', e=>e.results[0].assertion_ids.push('idempotency')],
  ['duplicate result', e=>e.results.push(e.results[0])],
  ['unknown result', e=>e.results.push({...e.results[0],check_id:'fake-extra'})],
  ['changed check definition', e=>e.results[0].definition_digest='sha256:'+'9'.repeat(64)],
  ['missing observer', e=>delete e.results[0].observer_id],
  ['invalid log hash', e=>e.results[0].log_digest='PASS'],
  ['changed source', e=>e.source_digest='sha256:'+'9'.repeat(64)],
  ['changed artifact', e=>e.artifact_digest='sha256:'+'9'.repeat(64)],
  ['changed environment', e=>e.environment_digest='sha256:'+'9'.repeat(64)],
  ['changed policy', e=>e.policy_digest='sha256:'+'9'.repeat(64)],
  ['wrong project', e=>e.project_id='other_project'],
  ['wrong run', e=>e.run_id='other_run'],
  ['wrong candidate', e=>e.candidate_id='other_candidate'],
  ['expired attempt', e=>e.attempt_id='old_attempt'],
  ['requirement change', e=>e.requirements_revision=2],
  ['issuer substitution', e=>e.issuer_id='model'],
  ['source changed during verification', e=>e.integrity_passed=false],
  ['blocking review finding', e=>e.blocking_findings=['authorization defect']],
  ['missing blocking finding field', e=>delete e.blocking_findings],
  ['future finish', e=>e.finished_at='2026-09-07T00:03:00Z'],
  ['invalid timestamp', e=>e.finished_at='tomorrow'],
  ['finish before start', e=>e.finished_at='2026-09-06T23:59:00Z'],
  ['evidence before candidate', e=>e.started_at='2026-09-06T23:59:00Z'],
  ['missing results', e=>delete e.results],
  ['string count', e=>e.results[0].tests_total='3'],
  ['unsupported evidence schema', e=>e.schema_version=2],
];
for (const [name,mutate] of mutations) test(`reject ${name}, even when signed by fixture issuer`,()=>{
  const input=inputs(), evidence=fixture('evidence');mutate(evidence);input.envelope=seal(evidence);
  assert.equal(evaluateEnvelope(input).verdict,'UNVERIFIED');
});
const contextMutations = [
  ['expired evidence', i=>i.now='2026-09-09T00:00:00Z'],
  ['advisory policy', i=>i.policy.authority='advisory'],
  ['empty policy', i=>i.policy.checks=[]],
  ['all optional policy', i=>i.policy.checks.forEach(c=>c.required=false)],
  ['duplicate definition', i=>i.policy.checks.push(i.policy.checks[0])],
  ['zero-test behavioral policy', i=>i.policy.checks[0].minimum_tests=0],
  ['revoked key', i=>i.trust.verifier_fixture.revoked=true],
  ['unknown issuer', i=>i.envelope.issuer_id='unknown'],
  ['missing trusted attempt', i=>delete i.expectedAttemptId],
  ['unapproved policy issuer', i=>i.policy.trusted_issuer_ids=[]],
  ['wrong policy revision', i=>i.policy.requirements_revision=2],
  ['unsupported signature algorithm', i=>i.envelope.algorithm='none'],
  ['malformed base64', i=>i.envelope.payload_base64='invalid$$'],
  ['oversized envelope', i=>i.envelope.payload_base64='a'.repeat(1_400_004)],
  ['payload altered after signing', i=>{const e=fixture('evidence');e.project_id='forged';i.envelope.payload_base64=Buffer.from(JSON.stringify(e)).toString('base64');}],
  ['signature replaced', i=>i.envelope.signature_base64=Buffer.alloc(64).toString('base64')],
];
for (const [name,mutate] of contextMutations) test(`reject ${name}`,()=>{const i=inputs();mutate(i);assert.equal(evaluateEnvelope(i).verdict,'UNVERIFIED');});
test('missing and malformed top-level inputs fail closed',()=>{
  for (const value of [undefined,null,{},[],{candidate:'done'}]) assert.equal(evaluateEnvelope(value).verdict,'UNVERIFIED');
});
const machine=JSON.parse(readFileSync(new URL('../contracts/state-machine.json',import.meta.url),'utf8'));
const transition={from:'VERIFYING',to:'READY_FOR_REVIEW',actor:'verifier',guards:{current_authenticated_evidence:true},expectedVersion:3,actualVersion:3};
test('trusted verifier can transition with current evidence and state version',()=>assert.equal(canTransition(machine,transition),true));
test('worker role cannot assign ready state',()=>assert.equal(canTransition(machine,{...transition,actor:'worker'}),false));
test('stale state version cannot transition',()=>assert.equal(canTransition(machine,{...transition,actualVersion:4}),false));
test('missing trusted evidence guard cannot transition',()=>assert.equal(canTransition(machine,{...transition,guards:{}}),false));
test('unlisted transition cannot occur',()=>assert.equal(canTransition(machine,{...transition,from:'RUNNING',to:'RELEASED'}),false));

test('malformed transition requests fail closed without throwing',()=>{
  for(const x of [null,undefined,[],{},'ready']) assert.equal(canTransition(machine,x),false);
});
test('inherited guard values cannot grant a transition',()=>{
  assert.equal(canTransition(machine,{...transition,guards:Object.create({current_authenticated_evidence:true})}),false);
});
test('intake blocker and cancellation have lifecycle transitions',()=>{
  for(const [to,guard] of [['BLOCKED','material_blocker'],['CANCELLED','cancel_requested_and_leases_revoked']]) {
    assert.equal(canTransition(machine,{from:'RECEIVED',to,actor:'controller',guards:{[guard]:true},expectedVersion:0,actualVersion:0}),true);
  }
});
test('precontract resume can return to intake, not unauthorized engineering',()=>{
  assert.equal(canTransition(machine,{from:'BLOCKED',to:'RECEIVED',actor:'controller',guards:{precontract_input_resolved:true},expectedVersion:2,actualVersion:2}),true);
});
test('signed evidence with date-only timestamps is unverified',()=>{
  const i=inputs(),e=fixture('evidence');e.started_at='2026-09-07';i.envelope=seal(e);
  assert.equal(evaluateEnvelope(i).verdict,'UNVERIFIED');
});
