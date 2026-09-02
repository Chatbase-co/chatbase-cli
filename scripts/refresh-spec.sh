#!/usr/bin/env bash
set -euo pipefail
# Refresh the vendored OpenAPI spec, then regenerate TypeScript types.
#
# Source resolution:
#   $1 if given, else the sibling private checkout's OpenAPI generator
#   (../chatbase, run via `bun scripts/generate-openapi.ts`) is used by
#   default and produces ../chatbase/openapi.json.
#   The docs-repo copy is kept in sync with the API (since Sep 2026) and
#   may be passed explicitly as $1; generating from the API checkout stays
#   the default since it reflects the exact code being deployed.
SRC="${1:-}"
if [ -z "$SRC" ]; then
    # Default: regenerate from the sibling private checkout.
    (cd ../chatbase && bun --preload ./scripts/mock-server-only.ts \
        scripts/generate-openapi.ts >/dev/null)
    SRC=../chatbase/openapi.json
fi
if [ ! -f "$SRC" ]; then
    echo "spec source not found: $SRC" >&2
    exit 1
fi
cp "$SRC" spec/openapi.json
npm run spec:generate
echo "vendored $(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('spec/openapi.json')).paths).length)") paths"
