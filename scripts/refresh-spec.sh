#!/usr/bin/env bash
set -euo pipefail
# Refresh the vendored OpenAPI spec, then regenerate TypeScript types.
#
# Source resolution:
#   $1 if given (local file path), else the public docs OpenAPI
#   (https://www.chatbase.co/docs/api-v2-openapi.json, overridable via
#   SPEC_DRIFT_URL — same knob as `npm run spec:drift`).
#   A private API checkout can still be passed explicitly after generating:
#     (cd ../chatbase && bun --preload ./scripts/mock-server-only.ts \
#         scripts/generate-openapi.ts)
#     npm run spec:refresh -- ../chatbase/openapi.json
DOCS_URL="${SPEC_DRIFT_URL:-https://www.chatbase.co/docs/api-v2-openapi.json}"
SRC="${1:-}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ -z "$SRC" ]; then
    command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
    if ! curl -fsSL --retry 3 -m 30 "$DOCS_URL" -o "$tmp/source.json"; then
        echo "failed to fetch $DOCS_URL" >&2
        exit 1
    fi
    SRC="$tmp/source.json"
    echo "fetched $DOCS_URL"
elif [ ! -f "$SRC" ]; then
    echo "spec source not found: $SRC" >&2
    exit 1
fi

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
# Drop the docs copy's duplicate "/api/v2/..."-prefixed path keys (known
# quirk). Harmless no-op for a clean API-generated file.
jq '.paths |= with_entries(select(.key | startswith("/api/v2/") | not))' \
    "$SRC" >spec/openapi.json

npm run spec:generate
echo "vendored $(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('spec/openapi.json')).paths).length)") paths"
