#!/usr/bin/env bash
set -euo pipefail
# Refresh the vendored OpenAPI spec, then regenerate TypeScript types.
#
# Source resolution:
#   $1 if given, else the sibling private checkout's routes-only generator
#   (../chatbase, run via `bun scripts/generate-openapi-routes-only.ts`) is
#   used by default and produces ../chatbase/openapi.json.
#   The docs-repo copy is a separate, independently-maintained artifact and
#   is known to drift from the API — never vendor it as a spec source.
SRC="${1:-}"
if [ -z "$SRC" ]; then
    # Default: regenerate from the sibling private checkout (routes-only generator).
    (cd ../chatbase && bun --conditions=react-server \
        --preload ./scripts/openapi-generator-stubs.ts \
        scripts/generate-openapi-routes-only.ts >/dev/null)
    SRC=../chatbase/openapi.json
fi
if [ ! -f "$SRC" ]; then
    echo "spec source not found: $SRC" >&2
    exit 1
fi
cp "$SRC" spec/openapi.json
npm run spec:generate
echo "vendored $(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('spec/openapi.json')).paths).length)") paths"
