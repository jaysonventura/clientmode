#!/usr/bin/env bash
# cdt-doctor — health check for the claude-dev-team install. Prints [ok]/[warn]/[FAIL] per component with
# a fix hint for anything not green. Read-only, fail-open.
set +e
CDT_HOME="$HOME/.claude"; BIN="$CDT_HOME/bin"; ENVF="$CDT_HOME/claude-dev-team.env"
DR_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"   # repo hooks/ dir when run from source (fallback paths)
ok=0; warn=0; bad=0
P(){ echo "  [ok]   $1"; ok=$((ok+1)); }
W(){ echo "  [warn] $1 — $2"; warn=$((warn+1)); }
F(){ echo "  [FAIL] $1 — $2"; bad=$((bad+1)); }
jval(){ command -v python3 >/dev/null 2>&1 && python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.claude/settings.json'))).get('$1',''))" 2>/dev/null; }
jenv(){ command -v python3 >/dev/null 2>&1 && python3 -c "import json,os;print((json.load(open(os.path.expanduser('~/.claude/settings.json'))).get('env') or {}).get('$1',''))" 2>/dev/null; }
genv(){ grep -E "^$1=" "$ENVF" 2>/dev/null | cut -d= -f2-; }

echo "claude-dev-team — doctor"

missing=""
for c in cdt-stats cdt-phase cdt-task cdt-tokens cdt-recall cdt-advise cdt-pr cdt-config cdt-doctor cdt-learn cdt-budget cdt-statusline cdt-deps cdt-worktree cdt-auto cdt-version cdt-obsidian cdt-plugins cdt-attribution cdt-mobile-qa cdt-web-qa; do
  [ -x "$BIN/$c" ] || missing="$missing $c"
done
[ -z "$missing" ] && P "CLIs installed" || W "CLIs missing:$missing" "open a new Claude Code session (the SessionStart hook installs them)"

# Toolkit: cdt-verify and the trusted verification verdict live in it. Unbuilt, a "done" goes unverified.
if [ -e "$BIN/cdt-verify" ]; then P "toolkit built (cdt-verify available)"
else
  _tk="$(ls -d "$DR_DIR/../toolkit" "$CDT_HOME"/plugins/cache/clientmode/cm/*/toolkit 2>/dev/null | sort -V | tail -1)"
  F "toolkit not built — cdt-verify and trusted verification are off" "read ${_tk:-the plugin toolkit}/.cdt-build.log, then: cd \"$_tk\" && npm install && npm run build"
fi

[ -f "$CDT_HOME/claude-dev-team.db" ] && P "state DB present" || W "state DB missing" "it populates as you complete tasks"
command -v python3 >/dev/null 2>&1 && P "python3 available" || F "python3 missing" "required for recall/advise/config — run: cdt-deps --install"

if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 && P "gh authenticated (autopilot ready)" || W "gh not authenticated" "gh auth login — only needed for /autopilot"
else W "gh not installed" "optional — only for /autopilot"; fi

# Worktree isolation: cdt-worktree needs git; native `claude --worktree` sessions need a recent CLI.
if command -v git >/dev/null 2>&1; then
  P "git present (cdt-worktree isolation ready)"
  if command -v claude >/dev/null 2>&1 && claude --help 2>/dev/null | grep -q -- '--worktree'; then
    P "claude --worktree supported"
  fi
else W "git not found" "worktree isolation + autopilot need git — run: cdt-deps --install"; fi

# Autonomous orchestration: the mode router + cost governor (cdt-auto). Engines are opt-in.
au="$(genv CDT_AUTONOMY)"; [ -z "$au" ] && au="assist"
tm="$(genv CDT_TEAMS)"; [ -z "$tm" ] && tm="off"
sc="$(genv CDT_SCALE)"; [ -z "$sc" ] && sc="off"
P "autonomy: $au  (teams=$tm · scale=$sc)"
if [ "$tm" = "on" ]; then
  [ "$(jenv CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)" = "1" ] && P "agent-team flag set (DEPTH ready)" \
    || W "agent-team flag missing" "re-run: cdt-config teams on (sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)"
fi
if [ "$sc" = "on" ]; then
  cv="$(command -v claude >/dev/null 2>&1 && claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ -n "$cv" ]; then
    [ "$(printf '%s\n2.1.154\n' "$cv" | sort -V | head -1)" = "2.1.154" ] && P "Claude Code $cv (workflow BREADTH ready)" \
      || W "Claude Code $cv < 2.1.154" "dynamic workflows need 2.1.154+ — update Claude Code"
  else
    W "scale on but Claude Code version unknown" "can't verify the 2.1.154+ requirement for workflows"
  fi
fi

en="$(grep -E '^CDT_ENABLED=' "$ENVF" 2>/dev/null | cut -d= -f2-)"
[ "$en" = "0" ] && W "CDT is DISABLED" "re-enable: cdt-config on" || P "CDT enabled"

eff="$(jval effortLevel)"; mdl="$(jval model)"
[ -n "$eff" ] && P "effort: $eff (pinned by you)" || P "effort: model default"
[ -n "$mdl" ] && P "model: $mdl (pinned by you)" || P "model: account default"

# Usage display: the status line is the ONLY writer of the session/weekly % cache (cdt-budget and
# cdt-auto only READ it). Claude Code runs it solely in a TERMINAL — not the VS Code/JetBrains chat panel — so if it's
# off, or you only ever use the IDE panel, the % never refreshes. Fix is one of: enable it + use a terminal.
sl="$(command -v python3 >/dev/null 2>&1 && python3 -c "import json,os;p=os.path.expanduser('~/.claude/settings.json');d=json.load(open(p)) if os.path.exists(p) else {};print('on' if 'cdt-statusline' in ((d.get('statusLine') or {}).get('command') or '') else 'off')" 2>/dev/null)"
[ "$sl" = "on" ] && P "status line on (feeds the usage % cache from any terminal)" \
  || W "status line off — usage % won't refresh" "enable: cdt-config statusline on  (it runs in a terminal only; in VS Code/JetBrains use the integrated terminal)"

# No-AI-attribution: commits/PRs must carry no "Co-Authored-By: Claude", no "Generated with Claude Code"
# footer and no session trailer. Source of truth = settings.json (includeCoAuthoredBy + attribution.*);
# cdt-attribution --check reads it read-only (exit 0 = compliant, 1 = would change).
attr_cmd=()
if [ -x "$BIN/cdt-attribution" ]; then attr_cmd=("$BIN/cdt-attribution")
elif [ -f "$DR_DIR/attribution.sh" ]; then attr_cmd=(bash "$DR_DIR/attribution.sh"); fi
na="$(genv CDT_NO_AI_ATTRIBUTION)"
case "$(printf '%s' "$na" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')" in
  0|off|false|no) echo "  [info] no-AI-attribution: enforcement off (explicitly disabled — settings.json not re-applied; re-enable: cdt-config attribution on)" ;;
  *)
    if [ ${#attr_cmd[@]} -eq 0 ]; then
      W "no-AI-attribution: cdt-attribution not installed" "open a new Claude Code session (the SessionStart hook installs it)"
    elif "${attr_cmd[@]}" --check >/dev/null 2>&1; then
      P "no-AI-attribution: in effect  (no Co-Authored-By / Generated-with-Claude-Code / session trailer on commits or PRs)"
    else
      W "no-AI-attribution: NOT in effect" "settings.json is missing the keys — fix: cdt-config attribution on  (detail: cdt-attribution --check)"
    fi ;;
esac

if command -v python3 >/dev/null 2>&1; then
  deps="$(python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.claude/settings.json'))).get('enabledPlugins',{});print(sum(1 for k in d if any(x in k for x in ['superpowers','code-review','frontend-design','context7'])))" 2>/dev/null)"
  [ "${deps:-0}" -ge 1 ] && P "companion plugins enabled ($deps)" || W "companion plugins not detected" "they auto-install with the plugin (needs Claude Code >= 2.1.143)"
fi

# Plugin subsystem (advisory) — delegate to the plugins doctor and surface its summary. Never fatal:
# prefer the generated bin, fall back to the repo hooks/plugins.sh, else note it isn't installed yet.
pl_sum=""
if [ -x "$BIN/cdt-plugins" ]; then
  pl_sum="$("$BIN/cdt-plugins" doctor 2>/dev/null | grep -v '^[[:space:]]*$' | tail -1)"
  [ -n "$pl_sum" ] && P "plugins: $pl_sum" || W "plugins doctor returned nothing" "run: cdt-plugins doctor"
elif [ -f "$DR_DIR/plugins.sh" ]; then
  pl_sum="$(bash "$DR_DIR/plugins.sh" doctor 2>/dev/null | grep -v '^[[:space:]]*$' | tail -1)"
  [ -n "$pl_sum" ] && P "plugins (repo): $pl_sum" || W "plugins subsystem not generated yet" "open a new Claude Code session (SessionStart installs cdt-plugins)"
else
  W "plugins subsystem not installed" "open a new Claude Code session to generate cdt-plugins"
fi

# Obsidian vault bridge check
obs_on="$(genv CDT_OBSIDIAN)"; obs_vault="$(genv CDT_OBSIDIAN_VAULT)"
# Effective state honors auto-use: a configured vault path enables sync unless explicitly off.
if [ "$obs_on" = "off" ]; then obs_eff="off"; obs_lbl="off"
elif [ "$obs_on" = "on" ]; then obs_eff="on"; obs_lbl="ON"
elif [ -n "$obs_vault" ]; then obs_eff="on"; obs_lbl="ON (auto)"
else obs_eff="off"; obs_lbl="off"; fi
if [ "$obs_eff" = "on" ]; then
  if [ -n "$obs_vault" ]; then
    if [ -d "$obs_vault" ]; then
      if [ -w "$obs_vault" ]; then
        last_obs="$(cat "$obs_vault/.cdt-last-sync" 2>/dev/null)"
        if [ -n "$last_obs" ]; then
          P "obsidian sync: $obs_lbl → $obs_vault  (last sync: $last_obs)"
        else
          W "obsidian sync: $obs_lbl → $obs_vault  (never synced)" "run: cdt-obsidian sync"
        fi
      else
        F "obsidian vault not writable" "check permissions: $obs_vault"
      fi
    else
      W "obsidian vault dir missing" "it will be created on first sync: $obs_vault"
    fi
  else
    W "obsidian sync ON but no vault path set" "run: cdt-config obsidian-vault <path>"
  fi
else
  P "obsidian sync: off  (enable by setting a path: cdt-config obsidian-vault <path>)"
fi

echo
echo "  $ok ok · $warn warn · $bad fail"
exit 0
