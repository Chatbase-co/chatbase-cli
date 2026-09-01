#!/usr/bin/env bash
set -euo pipefail
# CI guard: src/generated/api.d.ts must exactly match spec/openapi.json.
npx openapi-typescript spec/openapi.json -o /tmp/api-check.d.ts >/dev/null
if ! diff -q /tmp/api-check.d.ts src/generated/api.d.ts >/dev/null; then
    echo "src/generated/api.d.ts is out of sync with spec/openapi.json." >&2
    echo "Run: npm run spec:generate" >&2
    exit 1
fi
