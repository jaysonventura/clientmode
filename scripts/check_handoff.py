#!/usr/bin/env python3
"""Checks this handoff's structure/contracts, not a built Client Mode product.
Python 3.9+. jsonschema is required for actual JSON Schema instance validation.
"""
from pathlib import Path
import json
import re
import sys
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
errors = []
checks = []
not_run = []

def check(condition, message):
    if not condition: errors.append(message)

def load(path):
    return json.loads((ROOT/path).read_text(encoding='utf-8'))

required = ['START_HERE.md','BUILD_PROMPT.md','AGENTS.md','CLAUDE.md',
    'ENGINEERING_HANDOVER.md','docs/SECURITY_AND_RELEASE.md','docs/OPERATIONS.md',
    'docs/QUALIFICATION.md','docs/OFFICIAL_CAPABILITIES.md','docs/TASK_INDEX.md','docs/AI_ENGINEER_STACK_SCOPE.md',
    'docs/AI_COMPANY_OPERATING_MODEL.md','docs/DELIVERY_PROTOCOL.md','docs/RELEASE_ACCEPTANCE.md',
    'contracts/domain.schema.json','contracts/interfaces.ts','contracts/api.openapi.json',
    'contracts/state-machine.json','contracts/acceptance-scenarios.json','contracts/traceability.json',
    'contracts/storage/controller.sql','contracts/storage/verifier.sql','contracts/storage/release.sql',
    'reference/acceptance.mjs','tests/reference.test.mjs','tests/test_storage.py',
    'tests/test_engineering_context.py','tests/test_review_regressions.py','scripts/validate_all.py',
    'qa/REVIEW_REPORT.md','qa/HANDOFF_VALIDATION.md',
    'docs/DOCUMENT_WORKFLOW.md','research/COMPANY_PRACTICES.md','research/sources.json',
    'contracts/storage/documents.sql','contracts/storage/document-verifier.sql','tests/test_document_contracts.py']
for name in required: check((ROOT/name).is_file(), 'Missing required file: '+name)
check(len(list((ROOT/'docs/superpowers/plans').glob('*.md'))) == 8, 'Expected eight implementation plans')
checks.append('Required files and eight plans')

json_files=list((ROOT/'contracts').rglob('*.json'))
for p in json_files:
    try: json.loads(p.read_text(encoding='utf-8'))
    except (ValueError,OSError) as exc: errors.append(str(p.relative_to(ROOT))+': '+str(exc))
checks.append('Parsed %d JSON files' % len(json_files))

schema=load('contracts/domain.schema.json')
examples=list((ROOT/'contracts/examples').glob('*.json'))
try:
    import jsonschema
    jsonschema.Draft202012Validator.check_schema(schema)
    validator=jsonschema.Draft202012Validator(schema,format_checker=jsonschema.FormatChecker())
    for p in examples:
        for error in validator.iter_errors(json.loads(p.read_text(encoding='utf-8'))):
            errors.append('Schema '+p.name+': '+str(list(error.path))+' '+error.message)
    checks.append('Draft2020-12 schema and %d example instances, with format checking' % len(examples))
except ImportError:
    not_run.append('JSON Schema validation: jsonschema package unavailable')
    errors.append('Required dependency missing: jsonschema; schema validation did not run')

trace=load('contracts/traceability.json'); scenarios=load('contracts/acceptance-scenarios.json')['scenarios']
reqs=set(re.findall(r'\b(?:FR|NFR)-\d\d\b',(ROOT/'ENGINEERING_HANDOVER.md').read_text(encoding='utf-8')))
reqmap={r['requirement_id']:r for r in trace['requirements']}
tasks={t['id']:t for t in trace['tasks']}; cases={s['id']:s for s in scenarios}
check(set(reqmap)==reqs,'Requirement ID coverage mismatch')
check(len(tasks)==33 and len(cases)==33,'Expected33tasks and33scenario groups')
check(len(reqmap)==len(trace['requirements']),'Duplicate requirement record')
check(len(tasks)==len(trace['tasks']),'Duplicate task ID')
check(len(cases)==len(scenarios),'Duplicate scenario ID')
for req,r in reqmap.items():
    check(bool(r['task_ids']) and bool(r['acceptance_scenario_ids']), 'Unmapped requirement '+req)
    for tid in r['task_ids']:check(tid in tasks and req in tasks[tid]['requirement_ids'],'Task requirement inconsistency '+req+':'+tid)
    for sid in r['acceptance_scenario_ids']:check(sid in cases and req in cases[sid]['requirement_ids'],'Scenario requirement inconsistency '+req+':'+sid)
for tid,t in tasks.items():
    path=ROOT/t['plan_path']; check(path.is_file(),'Missing plan '+t['plan_path'])
    if path.is_file():check('## '+tid+':' in path.read_text(encoding='utf-8'),'Task absent from plan '+tid)
    for dep in t['depends_on']:check(dep in tasks and int(dep[1:])<int(tid[1:]),'Invalid/cyclic dependency '+tid+':'+dep)
    for sid in t['acceptance_scenario_ids']:check(sid in cases and cases[sid]['task_id']==tid,'Scenario task mismatch '+sid)
for sid,s in cases.items():
    check(bool(s['given']) and bool(s['when']) and bool(s['then']), 'Empty executable acceptance definition '+sid)
    check(s['status']=='NOT_EXECUTED_PRODUCT_TEST','Product scenario misrepresented as executed '+sid)
checks.append('%d requirements mapped to %d tasks and %d concrete scenario groups; dependencies acyclic' % (len(reqs),len(tasks),len(cases)))

source_records=load('research/sources.json')['sources']
source_ids={x['id'] for x in source_records}
check(len(source_ids)==len(source_records),'Duplicate research source ID')
for row in load('research/adoption-map.json')['mappings']:
    check(set(row['source_ids']).issubset(source_ids),'Unknown adoption source')
    check(set(row['requirement_ids']).issubset(reqs),'Unknown adoption requirement')
    check(set(row['task_ids']).issubset(tasks),'Unknown adoption task')
checks.append('Research-to-requirement adoption pointers validated; not source-claim or efficacy verification')

machine=load('contracts/state-machine.json');states=set(machine['states']);rules=machine['transitions']
check(states==set(schema['$defs']['Run']['properties']['state']['enum']),'State machine/schema mismatch')
seen=set()
for rule in rules:
    check(rule['from'] in states and rule['to'] in states,'Unknown transition state')
    check(rule['actor'] in ['controller','verifier','release'],'Worker has authoritative transition')
    key=(rule['from'],rule['to'],rule['actor']);check(key not in seen,'Duplicate transition');seen.add(key)
for rule in rules:
    if rule['to']=='READY_FOR_REVIEW':check(rule['actor']=='verifier' and rule['guard']=='current_authenticated_evidence','Unsafe ready transition')
checks.append('State-machine/schema identities and authoritative actor guards')
# AI remit is open-ended; the toolkit may remain TypeScript.
check('EngineeringContext' in schema['$defs'], 'Missing task engineering context')
for field in ['languages','frameworks','target_platforms']:
    item=schema['$defs']['EngineeringComponent']['properties'][field]['items']
    check(item.get('type')=='string' and 'enum' not in item, 'Closed stack whitelist: '+field)
check(set('FR-%02d' % n for n in range(37,43)).issubset(reqs), 'Missing all-stack requirements')
for tid,t in tasks.items():
    text=(ROOT/t['plan_path']).read_text(encoding='utf-8')
    match=re.search(r'## '+tid+r':(.*?)(?=\n## T\d\d:|\n## Milestone|\Z)',text,re.S)
    if not match: continue
    exp=re.search(r'const expected = (\{.*?\n\});',match.group(1),re.S)
    check(bool(exp), 'Missing expected test dictionary '+tid)
    if exp:
        check(json.loads(exp.group(1))==cases[t['acceptance_scenario_ids'][0]]['then'],
              'Plan/scenario assertion drift '+tid)
checks.append('Open-ended engineering context, six all-stack requirements, and matching plan/scenario assertions')


api=load('contracts/api.openapi.json');ops=set()
check(api['openapi'].startswith('3.1'),'OpenAPI design version')
check(api['servers'][0]['url'].startswith('http://127.0.0.1'),'Non-loopback default')
# Resolve every internal/external local JSON Pointer; this is structural, not full OAS conformance.
def pointer(value, fragment):
    if not fragment:return value
    if not fragment.startswith('/'):raise ValueError('Unsupported JSON pointer')
    for segment in fragment[1:].split('/'):
        segment=unquote(segment).replace('~1','/').replace('~0','~')
        value=value[int(segment)] if isinstance(value,list) else value[segment]
    return value

def inspect_refs(value,base):
    if isinstance(value,dict):
        if '$ref' in value:
            ref=value['$ref'];filepart,_,fragment=ref.partition('#')
            if urlparse(filepart).scheme:
                errors.append('Unexpected remote schema ref '+ref)
            else:
                target=(base.parent/filepart).resolve() if filepart else base
                try:
                    check(target.is_relative_to(ROOT),'Schema reference escapes archive '+ref)
                    pointer(json.loads(target.read_text(encoding='utf-8')),fragment)
                except (OSError,ValueError,KeyError,IndexError) as exc: errors.append('Unresolved ref '+ref+':'+str(exc))
        for child in value.values():inspect_refs(child,base)
    elif isinstance(value,list):
        for child in value:inspect_refs(child,base)
inspect_refs(schema,ROOT/'contracts/domain.schema.json')
inspect_refs(api,ROOT/'contracts/api.openapi.json')
for path,item in api['paths'].items():
    for method,o in item.items():
        if not isinstance(o,dict) or 'operationId' not in o:continue
        check(o['operationId'] not in ops,'Duplicate operation ID');ops.add(o['operationId'])
        pathargs=set(re.findall(r'{([^}]+)}',path))
        declared={x['name'] for x in o.get('parameters',[]) if x['in']=='path'}
        check(pathargs==declared,'Path parameter mismatch '+path)
        if method=='post':check(any(p['name']=='Idempotency-Key' for p in o['parameters']),'Mutation missing idempotency header '+path)
        if 'decision' in path or path=='/v1/releases':check(o['security']==[{'clientSession':[]}],'Unsafe approval/release security '+path)
checks.append('OpenAPI local refs, operation IDs, paths, auth/idempotency structure; %d operations' % len(ops))
not_run.append('Full OpenAPI tooling validation and implementation conformance')

# Check real Markdown links and code-fence balance; inline code paths to future product files are not asserted to exist.
for p in ROOT.rglob('*.md'):
    text=p.read_text(encoding='utf-8')
    fences=re.findall(r'^\s*(`{3,}|~{3,})',text,re.M)
    check(len(fences)%2==0,'Unbalanced code fences '+str(p.relative_to(ROOT)))
    check(not re.search(r'\b(?:TODO|TBD|FIXME)\b',text),'Unresolved placeholder marker '+str(p.relative_to(ROOT)))
    for link in re.findall(r'\]\(([^)]+)\)',text):
        if link.startswith(('http://','https://','mailto:','#','sandbox:')):continue
        dest=unquote(link.split('#')[0])
        if not dest:continue
        target=(p.parent/dest).resolve()
        check(target.is_relative_to(ROOT) and target.exists(),'Broken local Markdown link '+str(p.relative_to(ROOT))+':'+link)
checks.append('Markdown local links, code fences, unresolved-marker scan')
# Detect private-key material in distribution, never reject harmless test API references.
for p in ROOT.rglob('*'):
    if p.is_file() and p.suffix in ['.md','.json','.ts','.mjs','.sql','.py']:
        check(('-----BEGIN ' + 'PRIVATE KEY' + '-----') not in p.read_text(encoding='utf-8'),'Private key material included '+str(p.relative_to(ROOT)))
checks.append('No PEM private signing-key material included')
print(json.dumps({'status':'PASS' if not errors else 'FAIL','checks':checks,'not_run':not_run,'errors':errors},indent=2))
sys.exit(0 if not errors else 1)
