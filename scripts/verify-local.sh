#!/bin/sh
# Every gate this repository ships, in one exit code.
set -eu
cd "$(dirname "$0")/.."
echo "== typecheck"; npm run --silent typecheck
echo "== acceptance gates"; npm run --silent test:tasks
echo "== reference tests"; npm run --silent test:reference
echo "== handoff validation"; .venv/bin/python scripts/validate_all.py
