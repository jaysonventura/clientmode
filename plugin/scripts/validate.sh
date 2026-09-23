#!/usr/bin/env bash
# Validate the claude-dev-team plugin: JSON manifests, agent/skill/command frontmatter, shell scripts.
# Used by CI and runnable locally: bash scripts/validate.sh
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
err(){ echo "  FAIL: $*"; fail=1; }
ok(){ echo "  ok:   $*"; }

echo "== JSON manifests =="
for f in .claude-plugin/plugin.json ../.claude-plugin/marketplace.json hooks/hooks.json config/plugins.json; do
  python3 -m json.tool "$f" >/dev/null 2>&1 && ok "$f" || err "$f does not parse"
done

echo "== plugin registry (config/plugins.json) schema =="
if ! python3 - <<'PY'
import json, re, sys
REQ = {"id","displayName","type","marketplace","installIdentifier","enabledByDefault","required","scope",
       "categories","dependencies","activationRules","conflicts","needsAuth","securityLevel","fallbackBehavior"}
rx = re.compile(r'^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$')
try:
    d = json.load(open("config/plugins.json"))
except Exception as e:
    print("  FAIL: config/plugins.json does not parse:", e); sys.exit(1)
rows = d.get("plugins") if isinstance(d, dict) else None
if not isinstance(rows, list) or not rows:
    print("  FAIL: config/plugins.json has no plugins[]"); sys.exit(1)
bad = 0; ids = []
for p in rows:
    if not isinstance(p, dict):
        print("  FAIL: plugin row is not an object"); bad = 1; continue
    pid = p.get("id")
    miss = REQ - set(p)
    if miss: print("  FAIL: plugin '%s' missing keys: %s" % (pid, ", ".join(sorted(miss)))); bad = 1
    if pid: ids.append(pid)
    if p.get("type") == "cdt-skill":
        if p.get("installIdentifier") is not None:
            print("  FAIL: cdt-skill '%s' must have null installIdentifier" % pid); bad = 1
    else:
        ii = p.get("installIdentifier")
        if not (isinstance(ii, str) and rx.match(ii)):
            print("  FAIL: plugin '%s' bad installIdentifier: %r" % (pid, ii)); bad = 1
dups = sorted(set(x for x in ids if ids.count(x) > 1))
if dups: print("  FAIL: duplicate plugin ids: %s" % ", ".join(dups)); bad = 1
if not bad:
    print("  ok:   %d plugin rows — required keys present, ids unique, identifiers valid" % len(rows))
sys.exit(1 if bad else 0)
PY
then fail=1; fi

echo "== hooks.json command paths exist + executable =="
if ! python3 - <<'PY'
import json, os, re, sys
d = json.load(open("hooks/hooks.json"))
bad = 0
for event, groups in (d.get("hooks") or {}).items():
    for g in groups:
        for h in (g.get("hooks") or []):
            cmd = h.get("command", "")
            m = re.search(r'\$\{CLAUDE_PLUGIN_ROOT\}/([^"\']+)', cmd)
            if not m:
                continue
            p = m.group(1)
            if not os.path.isfile(p):
                print(f"  FAIL: {event}: hook file missing: {p}"); bad = 1
            elif not os.access(p, os.X_OK):
                print(f"  FAIL: {event}: hook not executable: {p}"); bad = 1
            else:
                print(f"  ok:   {event} -> {p}")
sys.exit(1 if bad else 0)
PY
then fail=1; fi

has_fm(){ head -12 "$1" | grep -q "^$2:"; }

echo "== Agents (need name + description) =="
for f in agents/*.md; do
  if has_fm "$f" name && has_fm "$f" description; then ok "$(basename "$f")"; else err "$f missing name/description"; fi
done

echo "== Skills (need name + description) =="
for f in skills/*/SKILL.md; do
  if has_fm "$f" name && has_fm "$f" description; then ok "$f"; else err "$f missing name/description"; fi
done

echo "== Commands (need description) =="
for f in commands/*.md; do
  if has_fm "$f" description; then ok "$(basename "$f")"; else err "$f missing description"; fi
done

echo "== Shell scripts =="
if command -v shellcheck >/dev/null 2>&1; then
  # SC1090/SC1091: scripts source runtime files (env, ~/.claude/bin helpers) shellcheck can't follow — not bugs.
  for f in hooks/*.sh scripts/*.sh; do
    if shellcheck -S warning -e SC1090,SC1091 "$f" >/dev/null 2>&1; then ok "$(basename "$f")"; else err "shellcheck: $f"; shellcheck -S warning -e SC1090,SC1091 "$f" | head -15; fi
  done
elif [ -n "${CI:-}" ]; then
  err "shellcheck is required in CI but not installed"
else
  echo "  skip: shellcheck not installed (local)"
fi

echo "== plugin.json <-> marketplace.json version/name sanity =="
if ! python3 - <<'PY'
import json,sys
p=json.load(open('.claude-plugin/plugin.json'))
m=json.load(open('../.claude-plugin/marketplace.json'))
errs=[]
if p.get('name')!='cm': errs.append('plugin name')
names=[x.get('name') for x in m.get('plugins',[])]
if 'cm' not in names: errs.append('marketplace missing plugin entry')
entry=[x for x in m.get('plugins',[]) if x.get('name')=='cm']
if entry and entry[0].get('source')!='./plugin': errs.append('marketplace entry must point at ./plugin')
if entry and entry[0].get('version') not in (None, p.get('version')): errs.append('marketplace version != plugin version')
for e in errs: print('  FAIL:', e)
sys.exit(1 if errs else 0)
PY
then fail=1; fi

echo "== status-line agent tracker (role helper + running_agents) =="
if ! python3 - <<'PY'
import os, sys, tempfile
sys.path.insert(0, "hooks")
import importlib
ce = importlib.import_module("cdt_emoji")
ra = importlib.import_module("running_agents")
errs = []
# role-name helper: strip a "plugin:" namespace prefix; plain text, no emoji
if ce.short("claude-dev-team:qa-engineer") != "qa-engineer": errs.append("short namespaced")
if ce.short("") != "agent": errs.append("short empty fallback")
if hasattr(ce, "emoji"): errs.append("cdt_emoji.emoji should be removed (plain-text output)")
# running set: add/remove/render in an isolated workspace
ws = tempfile.mkdtemp()
if ra.render(ws) != "": errs.append("empty render")
ra.add(ws, "Explore"); ra.add(ws, "Explore"); ra.add(ws, "backend-engineer")
seg = ra.render(ws)
if "Explore×2" not in seg or "backend-engineer×1" not in seg: errs.append("render counts: " + seg)
ra.remove(ws, "Explore")
if "Explore×1" not in ra.render(ws): errs.append("remove one")
ra.remove(ws, "Explore"); ra.remove(ws, "backend-engineer")
if ra.render(ws) != "": errs.append("render empty after removeall")
for e in errs: print("  FAIL:", e)
sys.exit(1 if errs else 0)
PY
then fail=1; else echo "  ok:   role-name helper + running-agents add/remove/render (plain text)"; fi

echo "== per-session usage cache (usage_cache.py — multi-terminal isolation) =="
if ! python3 - <<'PY'
import os, sys, tempfile, json
os.environ["HOME"] = tempfile.mkdtemp()                     # isolate the cache under a temp HOME
os.makedirs(os.path.join(os.environ["HOME"], ".claude"), exist_ok=True)
sys.path.insert(0, "hooks")
import usage_cache as uc                                     # CACHE resolves under the temp HOME at import
errs = []
a, b = uc.skey("/proj/a"), uc.skey("/proj/b")
uc.reset_session(a); uc.reset_session(b)
uc.incr_agent(a); uc.incr_agent(a); uc.incr_agent(b)        # A×2, B×1 — must NOT clobber each other
if uc.get_session(a).get("agent_count") != 2: errs.append("A count")
if uc.get_session(b).get("agent_count") != 1: errs.append("B count clobbered by A")
uc.update_ctx(a, 123, 1.0, {"weekly": 9})                  # A's context + account-wide weekly %
d = json.load(open(uc.CACHE))
if d.get("weekly") != 9: errs.append("account weekly not shared at top level")
if d["sessions"]["/proj/a"]["ctx_tokens"] != 123: errs.append("A ctx not stored per-session")
if d["sessions"]["/proj/b"]["agent_count"] != 1: errs.append("B not isolated after A write")
for e in errs: print("  FAIL:", e)
sys.exit(1 if errs else 0)
PY
then fail=1; else echo "  ok:   per-session metrics isolated; account usage shared"; fi

echo "== obsidian read-back recall (BM25 ranker + CLI gating) =="
if bash scripts/test-obsidian-recall.sh >/dev/null 2>&1; then
  ok "obsidian_recall.py ranker + cdt-obsidian recall subcommand"
else
  err "obsidian recall tests (run: bash scripts/test-obsidian-recall.sh)"
fi

# A skill body is read in full whenever it triggers, and orchestration triggers on every software
# task. Detail that only some tasks need lives in the skill's references/ and is read on demand.
echo "== ui-ux reference reproduction (bounded loop against the running page) =="
for needle in "reproduction, not" "two correction passes" "scripts/visual-check.mjs"; do
  grep -q "$needle" skills/ui-ux/SKILL.md && ok "ui-ux: $needle" || err "ui-ux lost: $needle"
done
[ -f skills/ui-ux/scripts/visual-check.mjs ] && ok "ui-ux ships scripts/visual-check.mjs" || err "ui-ux/scripts/visual-check.mjs missing"

echo "== history-lessons stays read-only and waits for approval =="
for needle in "Read-only in the audited repository" "Silence counts as rejected" "scripts/mine-history.mjs"; do
  grep -q "$needle" skills/history-lessons/SKILL.md && ok "history-lessons: $needle" || err "history-lessons lost: $needle"
done
[ -f skills/history-lessons/scripts/mine-history.mjs ] && ok "history-lessons ships scripts/mine-history.mjs" || err "history-lessons/scripts/mine-history.mjs missing"

# Approved lessons from the 2026-09-23 history-lessons audit of real repositories.
echo "== audited lessons stay in the skills =="
while IFS='|' read -r skill needle; do
  grep -qF "$needle" "skills/$skill/SKILL.md" && ok "$skill: $needle" || err "$skill lost: $needle"
done <<'LESSONS'
tdd|Fixtures must tell right from wrong
tdd|at least one test through the real callee
tdd|the same engine as production
tdd|same shell options
debug|list them in the commit
verify|no pre-deploy test gate
verify|Configuration is checked per stage
review|401 only for the caller's own credential
review|another tenant's record
intake|including sibling repositories
review|never a device clock
review|survives redelivery
review|Debug output and temporary routes
review|Per-tenant values come from one source
debug|Removing a documented capability
database-change|every other reader of the column
database-change|fail closed on an empty set
grounding|is a claim about the code
grounding|from its source, not from the UI
ui-ux|only after the server confirms it
ui-ux|WKWebView
LESSONS

# Every skill, command and agent description is loaded into every session; the body loads on use.
echo "== descriptions stay short (loaded every session; <= 40 words) =="
for f in skills/*/SKILL.md commands/*.md agents/*.md; do
  n="$(grep -m1 '^description:' "$f" | sed 's/^description:[[:space:]]*//' | wc -w | tr -d ' ')"
  [ "$n" -le 40 ] || err "$f description is $n words (ceiling 40)"
done
ok "description lengths checked"

echo "== skill size ceilings (always-triggered skills stay short) =="
for pair in orchestration:1500; do
  s="${pair%%:*}"; max="${pair##*:}"; words="$(wc -w < "skills/$s/SKILL.md" | tr -d ' ')"
  if [ "$words" -le "$max" ]; then ok "skills/$s/SKILL.md $words words (<= $max)"; else err "skills/$s/SKILL.md is $words words (ceiling $max) — move mode-specific detail to references/"; fi
done

echo
if [ "$fail" = 0 ]; then echo "ALL CHECKS PASSED"; else echo "VALIDATION FAILED"; exit 1; fi
