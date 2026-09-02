---
name: spec-sync
description: Sync the chatbase CLI with the Chatbase API v2 OpenAPI spec — refresh the vendored spec, regenerate types, find drift between spec and commands, fix what broke, scaffold commands and tests for new endpoints, and run the full verification gate. Use whenever the user mentions refreshing or updating the OpenAPI spec, syncing the CLI with the API, new/changed/removed endpoints, spec drift, a spec:check failure, or asks to add CLI commands for API endpoints — even if they never say the word "spec".
---

# Spec Sync

Keep the CLI in lockstep with the Chatbase API v2. The whole design of this
repo makes drift mechanically detectable — this skill walks the loop from
"refresh the spec" to "all gates green".

## How the pieces fit

- `spec/openapi.json` — the vendored spec, the single source of truth.
- `src/generated/api.d.ts` — `openapi-typescript` output. CI runs
  `npm run spec:check` and fails if it doesn't exactly match the spec.
- Commands call the typed `openapi-fetch` client with **literal spec paths**
  (`client.POST('/agents/{agentId}/...', ...)`). Keep doing this — the type
  system pins each call to the spec, and the coverage script below depends
  on finding those literals.
- `chatbase api <METHOD> <path>` is a generic escape hatch. An endpoint
  without a dedicated command is still reachable, so "no command" can be a
  deliberate choice, not a gap.

## Workflow

Work through the steps in order. Steps 1–4 are mechanical; step 5 needs
judgment and user sign-off; steps 6–7 are implementation.

### 1. Refresh the spec

To first check whether a refresh is even needed, `npm run spec:drift`
compares the vendored spec against the public docs spec (structurally,
ignoring prose) and lists endpoint-level drift — the same check CI runs
daily via `.github/workflows/spec-drift.yml`.

```bash
npm run spec:refresh                      # default: sibling ../chatbase checkout
npm run spec:refresh -- /path/to/openapi.json   # explicit source
```

The default regenerates the spec from the private API checkout expected at
`../chatbase` (needs `bun`), copies it to `spec/openapi.json`, and reruns
`spec:generate`. If the sibling checkout isn't there, ask the user where
their API checkout or spec file lives — don't guess. When the checkout
lives elsewhere, run the generator inside it yourself, then pass its
output as the explicit source:

```bash
(cd /path/to/chatbase && bun --preload ./scripts/mock-server-only.ts scripts/generate-openapi.ts)
npm run spec:refresh -- /path/to/chatbase/openapi.json
```

The docs-repo copy of
the spec is kept in sync with the API (since September 2026) and is an
acceptable explicit source; generating from the API checkout stays the
default because it reflects the exact code being deployed.

### 2. Read the diff

```bash
git diff --stat spec/openapi.json src/generated/api.d.ts
git diff spec/openapi.json
```

The `.d.ts` diff is machine noise; the spec diff is the readable one.
Classify every change into three buckets, because each gets different
treatment later:

- **Added** endpoints → step 5 (design new commands)
- **Removed** endpoints → step 4 (breaking-change discussion)
- **Changed** schemas/params on existing endpoints → step 4 (fix drift)

If the diff is empty, say so and skip to step 3 anyway — coverage gaps can
predate this refresh.

### 3. Map coverage

```bash
node .claude/skills/spec-sync/scripts/coverage.mjs   # from the repo root
```

It compares every `(method, path)` in the spec against literal path usage
in `src/` (excluding `src/generated/`) and prints:

- **Missing** — in the spec, no client call found. Candidates for step 5.
- **Verify manually** — the path literal exists in `src/` but not adjacent
  to a `.GET(`/`.POST(`/etc. call (usually a path picked via a variable,
  like `conversations list --user`). Open the file and confirm the method
  is actually exercised before treating it as covered.
- **Orphaned** — a spec-shaped path literal in `src/` that's no longer in
  the spec. These are compile errors waiting to happen; step 4 material.

Endpoints deliberately left without a command live in
`spec/coverage-ignore.json` (`[{"method", "path", "reason"}]`). When the
user decides to skip an endpoint, record it there with the reason — that
decision should survive to the next sync instead of being re-litigated.

### 4. Fix drift in existing commands

Start with `npm run typecheck` — the regenerated types surface most
breaking changes (renamed body fields, new required params, changed
response shapes) as compile errors in the commands that use them.

The type checker cannot see everything. Response fields that commands read
dynamically — table `Column` keys, fields plucked in tests' mock payloads —
break silently. For every renamed/removed schema field in the step-2 diff,
grep `src/` and `tests/` for the old name.

Update test mocks to the new contract deliberately: mocks encode the old
API shape, and a test passing against a stale mock is worse than a failing
one.

**Removed endpoints**: deleting a CLI command breaks users' scripts.
Confirm with the user before removing a command; mention the option of a
release-notes deprecation instead of silent removal.

### 5. Design commands for new endpoints — propose before building

For each **Missing** endpoint, decide: does it deserve a dedicated command?
Some endpoints are machine-to-machine plumbing (e.g. tool-result callbacks)
that CLI users would never type by hand — for those, propose adding them to
`spec/coverage-ignore.json` and note the `chatbase api` escape hatch.

For endpoints that do deserve commands, write a compact proposal per
endpoint — command name, args/flags, base class, output shape — and get the
user's confirmation before writing code, unless the user already
pre-approved the designs in their request. Command UX is much cheaper to
change as a proposal than as shipped code.

Design conventions (mirror the existing command tree):

- Topic = resource, verb = action: `tickets reply`, `sources restore`.
  Topic separator is a space. A new topic must be registered with a
  description under `oclif.topics` in `package.json` — and that is the
  only registration needed; commands auto-discover from
  `dist/commands/<topic>/`.
- Primary identifier is a positional arg where natural (`tickets get 42`);
  everything else is kebab-case flags. Agent selection always comes from
  the base class (`-a`/`--agent-name`), never a positional.
- Base class: `ListCommand` (src/base/list-command.ts) for paginated
  lists — brings `--limit/--cursor/--all` and pairs with `fetchPages`;
  `AgentCommand` for anything else that is agent-scoped (nearly
  everything); bare `BaseCommand` only for global endpoints like `health`.

### 6. Implement

Pick the nearest existing command as the exemplar and mirror it rather
than inventing structure:

| Shape | Exemplar |
|---|---|
| Write with typed body + positional arg | `src/commands/tickets/reply.ts` |
| Paginated list with table output | `src/commands/conversations/list.ts` |
| Simple get/delete | `src/commands/sources/get.ts`, `delete.ts` |

Conventions the reviewers of this repo expect:

- Request bodies typed from the spec:
  `type Body = components['schemas']['...']` imported from
  `../../generated/api.js`.
- A spec property with a `default` comes out **required** in the
  generated body type (openapi-typescript emits it non-optional) — set
  it explicitly, e.g. send `{}` for a defaulted empty object.
- Every client call is followed by `throwIfError(response, error)`.
- Output goes through the base helpers: `--json` (raw response), `--plain`,
  and the default table via `Column` arrays; writes end with
  `this.success(flags, ...)`; user mistakes throw `UsageError`.
- `static examples` on every command (help output asserts on them).
- Comments are sparse and explain constraints, not mechanics.

### 7. Test

Write vitest coverage for each new/changed command following
`tests/commands/tickets.test.ts`: undici `MockAgent` with
`disableNetConnect()`, intercepts against `https://www.chatbase.co` with
paths prefixed `/api/v2`, env stubs for `CHATBASE_API_KEY` /
`CHATBASE_AGENT_ID` / `XDG_CONFIG_HOME`. Cover at least: happy path
(assert on rendered output or `--json` passthrough), the request body sent
(for writes), and one error path.

Then run the full gate — all of it, in this order:

```bash
npm run build && npm run spec:check && npm run typecheck && npm run lint && npm test
```

Build comes first because the scaffold tests execute `bin/run.js`, which
loads compiled `dist/` — stale dist means the suite tests old code.

If an `oclif.manifest.json` exists in the repo root, delete it — it is an
untracked publish artifact (`prepack` regenerates it) and oclif prefers it
over scanning `dist/`, so in development a stale one silently hides new
commands from `bin/run.js` and a version-mismatched one spews warnings
onto stderr that break exact-output tests.

Run `npx biome check --write src tests` on your changed files before the
gate — the linter is strict about formatting (4-space indent, single
quotes) and auto-fixing saves a round-trip. The gate is judged on exit
codes: biome printing a pre-existing warning (there is a known
`noExplicitAny` one in `conversations/list.ts`) while exiting 0 is green.

If asked to also smoke-test against a live preview deployment: setting
`CHATBASE_API_URL` alone is a trap — file uploads (and the API key) would
still go to production. Set `CHATBASE_FILES_URL` as well.

### 8. Report

Summarize: endpoints added (with their new commands), changed (what was
fixed), removed, and deliberately skipped (now in the ignore file). State
the gate results plainly. Do not commit unless the user asks.
