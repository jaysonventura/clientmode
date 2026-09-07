#!/usr/bin/env python3
"""Validate only the handoff/reference package. No provider or product execution.
No auto-installation. A required missing tool/check produces nonzero exit.
Logs are written to qa/current/; final checksums must be refreshed by the packager.
"""
from pathlib import Path
import datetime
import json
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa/current'

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    commands=[
        ('schema_dependency',[sys.executable,'-c','import jsonschema; print(jsonschema.__file__)']),
        ('reference',['node','--test','tests/reference.test.mjs']),
        ('python',[sys.executable,'-m','unittest','discover','-s','tests','-p','test_*.py','-v']),
        ('structure',[sys.executable,'scripts/check_handoff.py']),
        ('typescript',['npm','run','--silent','typecheck'])
    ]
    rows=[]
    for name,argv in commands:
        log=OUT/(name+'.log')
        if shutil.which(argv[0]) is None:
            code=127;log.write_text('Required executable unavailable: '+argv[0]+'\n')
        else:
            try:
                with log.open('w') as f:
                    code=subprocess.run(argv,cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,timeout=120,check=False).returncode
            except subprocess.TimeoutExpired:code=124
            except OSError as exc:code=126;log.write_text(type(exc).__name__+': '+str(exc)+'\n')
        rows.append({'check':name,'argv':argv,'exit_code':code,'status':'PASS' if code==0 else 'FAIL','log':str(log.relative_to(ROOT))})
    passed=all(r['exit_code']==0 for r in rows)
    report={'scope':'HANDOFF_REFERENCE_ONLY','handoff_edition':'1.3','observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS' if passed else 'FAIL','checks':rows,'not_executed':['Full OpenAPI validator tooling (not installed in preparation environment)','Any live Client Mode runtime/API endpoint','Claude/Codex host or SDK qualification','OS/CI authority enforcement','Native/device/browser or model workload qualification','Real PDF/Office extraction, rendering, calculation and export', 'Cost/savings benchmark','Client acceptance or production deployment']}
    (OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    return 0 if passed else 1
if __name__=='__main__':sys.exit(main())
