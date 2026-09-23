#!/usr/bin/env bash
# cdt-learn "<lesson>" [area] [--source repo@sha] — append a durable lesson to the vault so cdt-recall /
# cdt-advise surface it on relevant future tasks. --source records where it came from (a history-lessons
# audit cites the commit). A lesson already in the vault is not appended again. The lesson is written to
# markdown (never sourced), so it's data, not code.
set +e

SOURCE=""; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$(printf '%s' "$2" | tr -cd 'A-Za-z0-9@._/-')"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
LESSON="${ARGS[0]}"; AREA="${ARGS[1]}"
[ -z "$LESSON" ] && { echo "usage: cdt-learn \"<lesson>\" [area] [--source repo@sha]"; exit 0; }

VAULT="${CDT_VAULT:-$HOME/.claude/vault}"
mkdir -p "$VAULT" 2>/dev/null
LEARN="$VAULT/learnings.md"
[ -f "$LEARN" ] || printf '# Learnings\n\nDurable lessons the orchestrator recalls across sessions.\n\n' > "$LEARN"

DATE="$(date +%Y-%m-%d 2>/dev/null)"
CLEAN="$(printf '%s' "$LESSON" | tr '\n\r\t' '   ')"                 # one lesson per line
PREFIX=""
[ -n "$AREA" ] && PREFIX="$(printf '%s' "$AREA" | tr -cd 'A-Za-z0-9 _-')"": "

if WANT="${PREFIX}${CLEAN}" awk '{ sub(/^- \[[0-9-]+\] /, ""); sub(/ \[src: [^]]*\]$/, "")
     if ($0 == ENVIRON["WANT"]) { found = 1; exit } } END { exit !found }' "$LEARN" 2>/dev/null; then
  touch "$LEARN"   # the lesson is persisted: the memory gate reads that from the vault's mtime
  echo "already in the vault: ${PREFIX}${CLEAN}"
  exit 0
fi
SUFFIX=""
[ -n "$SOURCE" ] && SUFFIX=" [src: $SOURCE]"

printf -- '- [%s] %s%s%s\n' "$DATE" "$PREFIX" "$CLEAN" "$SUFFIX" >> "$LEARN"
echo "learned → - [$DATE] ${PREFIX}${CLEAN}${SUFFIX}"
echo "(cdt-recall will surface it on relevant future tasks)"
exit 0
