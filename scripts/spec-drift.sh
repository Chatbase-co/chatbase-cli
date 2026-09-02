#!/usr/bin/env bash
set -euo pipefail
# Detect drift between the vendored spec and the docs-site copy, which is
# kept in sync with the deployed API. Fails (exit 1) when the vendored
# spec is behind — the fix is a spec sync, not a code change here.
#
# Comparison is structural: doc-prose `description` strings are stripped
# (hand-polished on the docs side, expected to differ) and the docs copy's
# duplicate "/api/v2/..."-prefixed path keys are dropped (known docs quirk).
DOCS_URL="${SPEC_DRIFT_URL:-https://www.chatbase.co/docs/api-v2-openapi.json}"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! curl -fsSL --retry 3 -m 30 "$DOCS_URL" -o "$tmp/docs.json"; then
    echo "failed to fetch $DOCS_URL" >&2
    exit 2
fi

# Compare only what can affect the CLI: `info` (display metadata) and
# `servers` (advertised base URL — the CLI takes its base URL from config)
# are dropped up front. Only string-valued `description` keys are prose; a
# schema *property* named "description" (e.g. Ticket.description) is an
# object and survives. Everything else stays strict on purpose — schema
# changes feed the generated request/response types.
NORMALIZE='del(.info, .servers)
    | walk(if type == "object" and (.description? | type == "string")
    then del(.description) else . end)'

jq -S "$NORMALIZE" spec/openapi.json > "$tmp/local.json"
jq -S '.paths |= with_entries(select(.key | startswith("/api/v2/") | not))
    | '"$NORMALIZE" "$tmp/docs.json" > "$tmp/remote.json"

if diff -q "$tmp/local.json" "$tmp/remote.json" >/dev/null; then
    echo "spec/openapi.json matches the docs spec" \
        "($(jq -r '.paths | keys | length' "$tmp/local.json") paths)."
    exit 0
fi

endpoints() {
    jq -r '.paths | to_entries[] | .key as $p | (.value | keys[]) as $m
        | select($m | IN("get", "post", "put", "patch", "delete"))
        | "\($m | ascii_upcase) \($p)"' "$1" | sort
}
endpoints "$tmp/local.json" > "$tmp/local-endpoints"
endpoints "$tmp/remote.json" > "$tmp/remote-endpoints"

echo "Drift detected between spec/openapi.json and $DOCS_URL"
added=$(comm -13 "$tmp/local-endpoints" "$tmp/remote-endpoints")
removed=$(comm -23 "$tmp/local-endpoints" "$tmp/remote-endpoints")
if [ -n "$added" ]; then
    printf 'Endpoints in the API but not vendored:\n%s\n' "$added"
fi
if [ -n "$removed" ]; then
    printf 'Endpoints vendored but no longer in the API:\n%s\n' "$removed"
fi
if [ -z "$added" ] && [ -z "$removed" ]; then
    echo "Same endpoints; schema or parameter definitions differ:"
    # diff exits 1 on difference (and 141 if head cuts it off) — that must
    # not kill the script before the guidance below prints.
    diff "$tmp/local.json" "$tmp/remote.json" | head -40 || true
fi
echo "Run \`npm run spec:refresh\` — or the spec-sync skill — to sync." >&2
exit 1
