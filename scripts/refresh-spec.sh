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
# Vendor the source verbatim.
#
# This used to strip every "/api/v2/..."-prefixed path key as a docs-copy
# quirk. That was wrong: the two prefixed keys are the real multipart file
# endpoints (createFileSource, updateFileSource), which carry their own
# `servers` override pointing at files.chatbase.co and so must spell out the
# full path. They are not duplicates of the unprefixed source routes — those
# are the JSON create/update operations. Stripping them silently dropped two
# operations from the vendored spec and from the generated types.
jq '.' "$SRC" >spec/openapi.json

npm run spec:generate
echo "vendored $(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('spec/openapi.json')).paths).length)") paths"
