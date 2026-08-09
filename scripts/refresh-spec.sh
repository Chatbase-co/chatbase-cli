#!/usr/bin/env bash
set -euo pipefail
# Refresh the vendored OpenAPI spec, then regenerate TypeScript types.
#
# Source resolution:
#   $1 if given, else the docs-repo copy (currently the only runnable source:
#   the private repo generator (npm run generate:openapi in ../chatbase)
#   cannot run standalone yet — it imports Next-only modules. Once the
#   private repo ships its routes-only generator, pass its output here.)
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
