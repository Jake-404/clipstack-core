#!/usr/bin/env bash
# core/ cannot import from signals/. CI gate.
# Catches: Python `from signals` / `import signals`, TypeScript `from 'signals` / `from "signals` / `from '@signals`,
# YAML/JSON $ref into ../signals, SQL include of signals/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[isolation] scanning core/ for forbidden signals/ references..."

# Forbidden import shapes. Each pattern is a *real* import statement —
# narrow enough that prose mentions of "signals/" in comments / READMEs / CI
# job names don't trip the gate.
#
# Per file-type:
#   Python:  `from signals.X import ...` or `from signals import ...` or `import signals.X`
#   TS/JS:   `from 'signals/...'` or `from "@signals/..."` or `require('signals/...')`
#   Path:    `../signals/` or `../../signals/` (relative climbs from any depth)
PATTERNS_PY=(
  "^[[:space:]]*from[[:space:]]+signals(\.|[[:space:]]+import)"
  "^[[:space:]]*import[[:space:]]+signals(\.|[[:space:]]|$)"
)
PATTERNS_TS=(
  "from[[:space:]]+['\"]signals/"
  "from[[:space:]]+['\"]@signals/"
  "require\([[:space:]]*['\"]signals/"
  "require\([[:space:]]*['\"]@signals/"
)
PATTERNS_PATH=(
  "\.\./signals/"
  "\.\./\.\./signals/"
)

# Files whose entire purpose is to enforce / document this gate. They
# necessarily mention "signals/" in prose and would otherwise trip the regex.
ALLOWLIST_REGEX="^${ROOT}/(scripts/check-core-isolation\.sh|\.github/workflows/.*\.ya?ml|README\.md|CONTRIBUTING\.md)$"

EXIT=0
scan() {
  local pat="$1"
  shift
  local includes=("$@")
  local matches
  matches=$(grep -rEn "${includes[@]}" "$pat" "$ROOT" 2>/dev/null || true)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local file="${line%%:*}"
    if [[ "$file" =~ $ALLOWLIST_REGEX ]]; then
      continue
    fi
    echo "[isolation] FORBIDDEN: pattern '$pat':"
    echo "  $line"
    EXIT=1
  done <<< "$matches"
}

for pat in "${PATTERNS_PY[@]}"; do
  scan "$pat" --include='*.py'
done
for pat in "${PATTERNS_TS[@]}"; do
  scan "$pat" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs'
done
for pat in "${PATTERNS_PATH[@]}"; do
  scan "$pat" --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' --include='*.yaml' --include='*.yml' --include='*.json' --include='*.sql'
done

if [ $EXIT -eq 0 ]; then
  echo "[isolation] OK — core/ is clean of signals/ references."
else
  echo ""
  echo "[isolation] FAIL — core/ must not import from signals/."
  echo "[isolation] If you need a regulatory rule / algorithm heuristic / crisis playbook / persona / KOL roster,"
  echo "[isolation] put it behind an interface in core/services/<service>/ and let signals/ provide the concrete value."
fi

exit $EXIT
