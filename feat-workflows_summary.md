# PR #3 Summary: Chat REPL, sources sync, and release pipeline

## Main Change

This PR (Plans 3+4) adds three CLI-facing capabilities on top of the typed OpenAPI client: an interactive **chat REPL** and one-shot chat command built around a hand-rolled **SSE parser** for AI-SDK `UIMessage` streams; a stateless **sources-sync engine** (diff → plan → confirm → execute) that converges a local directory to an agent's remote file sources; and a **browser-based pairing login** flow that migrates auth off `rawApiFetch` onto the typed client and adds server-side key revocation. It also stands up the **release pipeline** (release-please, npm provenance publish, a Windows CI matrix, and a staging E2E smoke suite) needed to ship the CLI publicly.

## Core Change
> **`src/client/stream.ts`** and **`src/sync/diff.ts`** — the two hand-rolled, dependency-free algorithmic cores everything else in this PR wraps around: a ~50-line SSE parser (explicitly chosen over a library, per its own header comment, because the real work is Chatbase-specific event mapping, not generic SSE splitting) and a pure `(LocalFile[], SourceItem[]) → SyncPlan` diff function with no I/O.

Ripple effects:
- Every chat surface — one-shot (`chat/index.ts`), retry (`chat/retry.ts`), and the interactive REPL (`repl/chat-repl.ts`) — routes through `parseSseStream` via the shared `sendChat`/`retryChat` helpers in `chat-helpers.ts`; a format change in the parser ripples into all three at once.
- The per-call `AbortSignal` plumbing added to `client.ts` exists solely so Ctrl-C can cancel one in-flight stream read without killing the process — it wires `stream.ts`, `chat-helpers.ts`, and `chat-repl.ts` together.
- `computeSyncPlan`'s pure, side-effect-free contract is what let `execute.ts`, `render.ts`, and `commands/sources/sync.ts` be built and unit-tested independently against a fixed data shape instead of a live API.
- Reverting either nucleus file removes the engine that the command layer merely orchestrates — the commands would have nothing left to call.

---

## Logical Change 1: SSE Stream Parser & Shared Chat Client Helpers (core)

The hand-rolled SSE parser and the `sendChat`/`retryChat`/`handleResponse` helper layer that every chat surface calls into. Includes the per-call `AbortSignal` support in the shared client needed to cancel one in-flight stream without touching the process-wide SIGINT handling.

| File | Changes |
|------|---------|
| **`src/client/stream.ts`** (new, ~85 lines) | `parseSseStream()` — hand-rolled SSE parser for AI-SDK `UIMessage` events (`text-delta`, `message-metadata`/`finish`, `[DONE]`); tolerant of chunk-boundary splits, races an idle timeout (reports the actual configured duration in the error), ignores unknown part types, and releases the reader in a `finally` on every exit path. |
| **`src/client/chat-helpers.ts`** (new, ~163 lines) | `sendChat`/`retryChat` (typed POSTs with `parseAs: 'stream'` vs `'json'`) sharing a `handleResponse()` that dispatches to `parseSseStream` or the non-streaming JSON envelope; `extractText()`; `fetchRecentHistory()` for the `--resume` banner. |
| `src/client/client.ts` | `toPlainRequestInit` now threads an optional per-request `signal` into `AbortSignal.any([timeout, sigint, ...signal])`, so a single in-flight fetch can be cancelled independently of the process-wide interrupt; comment on `rawApiFetch` clarified as a `gh api`-style escape hatch. |
| `tests/client/stream.test.ts` (new, ~114 lines) | Text/metadata/done emission, chunk-boundary splitting, idle timeout (message includes actual duration), reader released on `[DONE]`/stream-end/timeout. |
| `tests/client/chat-helpers.test.ts` (new) | `sendChat` rejects immediately on an already-aborted signal without hitting the network; `fetchRecentHistory` truncation/ordering. |
| `tests/client/chat-helpers-retry.test.ts` (new) | `retryChat` calls the retry endpoint correctly. |
| `tests/client/client.test.ts` | New `describe('per-call AbortSignal')` block: a passed signal aborts without touching the network; an unaborted signal has no effect. |

---

## Logical Change 2: Chat Commands — One-shot, Retry & Interactive REPL (consequence of 1)

The three user-facing chat surfaces, all thin orchestrators over Logical Change 1's helpers, plus the typing spinner used to cover dead air before the first streamed token.

| File | Changes |
|------|---------|
| **`src/commands/chat/index.ts`** (new, ~238 lines) | `chatbase chat` — one-shot (`-m`, piped stdin) and interactive REPL entry (TTY with no message/stdin); `--json`/`--no-stream` force non-streaming; wires `runChatRepl`'s `send`/`retry` deps with a fresh per-turn `AbortController` and a "Typing…" spinner until the first token. |
| **`src/commands/chat/retry.ts`** (new, ~83 lines) | `chatbase chat retry` — retries a specific message via `retryChat`, same streaming/spinner/JSON conventions as one-shot chat. |
| **`src/repl/chat-repl.ts`** (new, ~148 lines) | `runChatRepl()` — dependency-injected REPL loop (`/exit`, `/new`, `/retry`, `/id`, `/help`); readline `terminal: true` intercepts Ctrl-C as its own `'SIGINT'` event, aborting only the in-flight call's controller (idle Ctrl-C exits, matching `/exit`). |
| **`src/output/spinner.ts`** (new, ~31 lines) | `startSpinner()` — stderr-only, TTY-gated braille spinner with a configurable delay so sub-second waits never flicker; used here as the "Typing…" indicator. |
| `src/base/body-input.ts` | `readStdinToEnd()` extracted and exported (previously inline in `resolveInput`'s `@-` handling) — now the single shared implementation used by piped-stdin chat and, per Logical Change 5, `auth login --with-token`. |
| `tests/repl/chat-repl.test.ts` (new, ~233 lines) | Send/track-conversation-id, `/new`/`/retry`/`/id`/`/help`, Ctrl-D exit, unknown-command hint, Ctrl-C cancels only the in-flight response vs. exits at an idle prompt. |
| `tests/commands/chat-oneshot.test.ts` (new, ~226 lines) | Streamed token order, request body shape, `--conversation`/`--json`/`--no-stream`, stdin fallback, TTY-with-no-message enters the REPL. |

---

## Logical Change 3: Stateless Sync Engine — Diff, Execute, Render (core)

The pure directory-scan/diff algorithm and the two thin layers built directly on its output type (`SyncPlan`): a concurrency-pooled executor and a git-push-style renderer. No file here makes a network call except `execute.ts`'s upload/delete calls.

| File | Changes |
|------|---------|
| **`src/sync/diff.ts`** (new, ~182 lines) | `scanDir()` (glob include/exclude with `**`, `*`, `?`, pruning excluded directories during the walk) and `computeSyncPlan()` — pure `(local, remote) → { create, update, del, unchanged, caseCollisions }`; only `type: 'file'` remote sources participate, and sources already `toBeDeleted`/`deleted` are excluded so a pending remote delete can't suppress a same-named local create. |
| **`src/sync/execute.ts`** (new, ~118 lines) | `executeSyncPlan()` — a dependency-free `pool()` (shared-cursor concurrency limiter, default 4) drives uploads then deletes; failures are collected (never thrown) so one bad file doesn't abort the rest; `onProgress` fires once per completed op. |
| **`src/sync/render.ts`** (new, ~25 lines) | `renderPlan()` — git-push-style summary (`+N created ~N updated −N deleted (N unchanged)`) plus one colored line per change. |
| `tests/sync/diff.test.ts` (new, ~180 lines) | Create/update/delete/unchanged classification, non-file sources ignored, `toBeDeleted`/`deleted` don't suppress creates, case-collision detection, glob wildcard semantics (incl. `?` as single-char). |
| `tests/sync/execute.test.ts` (new, ~268 lines) | Upload+delete execution, failure collection without throwing, concurrency limit enforcement (default 4), per-op progress callback. |
| `tests/sync/render.test.ts` (new, ~108 lines) | Summary line format, per-file prefixes, empty-plan output, color-by-status. |

---

## Logical Change 4: Sources Sync Command & Source Management Fixes (consequence of 3)

`chatbase sources sync` orchestrates Logical Change 3's engine with project-config resolution and a tiered confirmation gate; alongside it, smaller fixes to the existing `sources create/update/delete` commands that the sync work surfaced.

| File | Changes |
|------|---------|
| **`src/commands/sources/sync.ts`** (new, ~232 lines) | `chatbase sources sync [dir]` — resolves the target dir (positional > `chatbase.json` `sync.dir`, relative to the config file's own directory, not cwd); plan → confirm → execute; confirmation is `--force`-skippable, y/N on a TTY, escalated to typed-agent-ID confirmation when the plan would delete >50% of an agent's file sources, and refused outright (naming which tier it would have hit) when non-interactive; a no-op plan never prompts. |
| `src/config/project.ts` | `ProjectConfig.sync?: { dir, include, exclude }`; `parseSyncConfig()` drops malformed fields rather than throwing (a typo in `chatbase.json` shouldn't block unrelated commands). |
| `src/base/sources.ts` | `renderStatus()` gains a `REMOVED` set (`deleted` → `✗`) and folds `toBeDeleted` into `PENDING` (`…`) — needed so sync's plan preview and `sources list` render deletion state correctly. |
| `src/client/files.ts` | `uploadFileSource()` fix: the upload response is the source object itself (`{ id, ... }`), not a `{ data: { id } }` envelope — was silently failing to extract the ID. |
| `src/commands/sources/create.ts` | Wraps the upload call in `startSpinner('Uploading {file}…')`. |
| `src/commands/sources/update.ts` | Same upload spinner as `create.ts`. |
| `src/commands/sources/delete.ts` | Restore hint (`↩ restore with...`) now only prints when the delete response `status === 'toBeDeleted'` — never-trained sources are hard-deleted and have no restore path, so the hint no longer lies to the user. |
| `src/output/spinner.ts` (new) | Same `startSpinner()` as Logical Change 2, reused here for `Uploading {file}…`. |
| `tests/commands/sources-sync.test.ts` (new, ~437 lines) | Dry-run, `--force`, non-interactive refusal (exit 2), high-risk typed-ID escalation, failure path (exit 1, reprints failing file), `sync.dir` from `chatbase.json` (resolved relative to the file), interactive y/N confirm, case-collision warning, `--include` override, no-op plan never prompts. |
| `tests/commands/sources-create.test.ts` | Minor update alongside the spinner change. |
| `tests/commands/sources-write.test.ts` | Restore-hint fix: present for `toBeDeleted`, absent for a hard-deleted untrained source. |
| `tests/config/project.test.ts` (new, ~37 lines) | `sync.dir/include/exclude` parsing, and malformed/absent `sync` blocks degrade to `undefined` instead of throwing. |
| `tests/client/files.test.ts` | Updated for the corrected (non-enveloped) upload response shape. |

---

## Logical Change 5: Browser Pairing Login & API Spec Refresh (core)

A second, independent architectural decision: an unauthenticated device-pairing flow (`POST /cli/pairing` → user approves in browser → poll `/cli/pairing/exchange`) that mints an API key without ever putting the pairing code in a URL, plus the typed-client migration and API spec refresh it required.

| File | Changes |
|------|---------|
| **`src/client/pairing.ts`** (new, ~99 lines) | `startPairing()` / `pollExchange()` — unauthenticated typed-client calls; polls on the server-given interval (doubling on `PAIRING_SLOW_DOWN`), throws a `UsageError` on expiry. |
| `src/commands/auth/login.ts` | Interactive picker ("Log in with browser" / "Paste an API key"); `--browser` flag drives `browserLogin()` (prints the code, opens the browser via `tryOpenBrowser`, polls, stores `apiKeySource: 'pairing'`); Windows fix — spawns via `cmd /c start '' <url>` since bare `start` is a cmd.exe builtin, not an executable; pasted-key path (`verifyAndStore`) migrated from `rawApiFetch` to the typed client and strips any stale `apiKeySource`; stdin reading for `--with-token` now delegates to the shared `readStdinToEnd` from Logical Change 2 instead of a local copy. |
| `src/config/store.ts` | `UserConfig.apiKeySource?: 'pairing'` — marks keys minted via browser login so logout knows to revoke them server-side; pasted keys are left unmarked (may be shared with CI/teammates). |
| `spec/openapi.json` | Adds `/me`, `/me/credential`, `/cli/pairing`, `/cli/pairing/exchange`; removes `/agents/{agentId}/conversations/{conversationId}/tool-result` (backs the removed `tools submit-result` command). Reformatted 2→4-space indent, so most of the ~22k-line diff is noise around these path-level changes. |
| `src/generated/api.d.ts` | Regenerated types for the same path additions/removal (874 lines changed) — the typed contract every `client/*.ts` call above compiles against. |
| `tests/commands/auth.test.ts` | New coverage for `--browser` (Windows `cmd /c start` invocation), logout revocation paths, expired-credential and non-2xx `/me` handling (spans Logical Changes 5 and 6). |
| `tests/config/store.test.ts` | Covers `apiKeySource` persistence. |

---

## Logical Change 6: Auth Status & Logout Upgrades (consequence of 5)

`auth status` and `auth logout` consume the expanded `/me` contract and the new `/me/credential` endpoint that the pairing work added to the spec.

| File | Changes |
|------|---------|
| `src/commands/auth/status.ts` | Migrated from `rawApiFetch` to the typed client; now reads `credential.{source,expiresAt,permissions}` off `/me` to show CLI-paired label, expiry ("Already expired" / 7-day warning), and scopes; distinguishes `API_KEY_EXPIRED` vs `PERMISSION_DENIED` vs generic invalid on 401/403 by error code; surfaces 5xx/429 instead of silently exiting 0. |
| `src/commands/auth/logout.ts` | For `apiKeySource === 'pairing'` keys, calls `DELETE /me/credential` to revoke server-side before removing the local config (best-effort — local removal happens either way, with a yellow warning if the revoke call fails or errors). |
| `src/base/base-command.ts` | New generic error branch: a `SyntaxError` from a response body that looks like an HTML page (`<!DOCTYPE` / "is not valid JSON") now prints a clear "server returned HTML instead of JSON — check `CHATBASE_API_URL`" message with the resolved base URL, instead of falling through to the generic unexpected-error path. |

---

## Logical Change 7: Release Pipeline, CI Hardening & E2E Smoke Tests (core)

An independent initiative (not derived from the chat/sync/auth work above): the machinery to actually publish this CLI as an npm package and gate that publish on real tests against staging.

| File | Changes |
|------|---------|
| **`src/../.github/workflows/release.yml`** (new) | `release-please-action` → on a created release, a `publish` job re-runs lint/typecheck/spec:check/tests, then `npm publish --provenance --access public` using `NPM_TOKEN`. |
| **`.github/workflows/e2e.yml`** (new) | Runs `npm run test:e2e` on `release: published` and `workflow_dispatch`, using `CHATBASE_E2E_API_URL`/`CHATBASE_E2E_API_KEY`/`CHATBASE_E2E_AGENT_ID` secrets. |
| `.github/workflows/ci.yml` | Adds a `permissions` block and a `concurrency` group (cancel-in-progress); matrix gains `windows-latest`; new step `npx oclif readme && git diff --exit-code README.md` fails CI on README drift; `STARTUP_BUDGET_MS` widened for Windows. |
| **`release-please-config.json`** (new) | `release-type: node`, package name `chatbase`. |
| **`.release-please-manifest.json`** (new) | Seeds version `0.1.0`. |
| **`.gitattributes`** (new) | `* text=auto eol=lf` — forces LF so Windows checkouts don't get CRLF and fail Biome lint. |
| `package.json` | Adds `repository` field (required for npm provenance); adds `test:e2e` script. |
| **`tests/e2e/smoke.e2e.ts`** (new, ~47 lines) | 5 tests (`health`, `agents list`, `sources list`, `chat` one-shot, `conversations list`) run via `execFileSync` against the real built binary and a real staging API; `describe.skipIf` when the env vars are absent. |
| `vitest.config.ts` | Detects the e2e invocation from `process.argv` so one config both excludes `tests/e2e/**` from the default run and targets only it under `vitest run tests/e2e` (Vitest's path filter can only narrow `include`, not widen past `exclude`). |

---

## Logical Change 8: Documentation — README & Launch Checklist (consequence of 1, 3, 5, 7)

Auto-generated command reference and the release-readiness checklist, both touched by every feature above.

| File | Changes |
|------|---------|
| `README.md` | Regenerated via `oclif readme` for the full new command set — adds `chatbase chat`, `chatbase chat retry`, `chatbase sources sync [DIR]` sections (now enforced against drift by Logical Change 7's CI step). |
| `docs/launch-checklist.md` | Adds a "GitHub secrets" checklist (`NPM_TOKEN`, the three `CHATBASE_E2E_*` vars); flags outstanding server-side work: an RLS policy reminder for the new `cli_pairing_requests` table, a pending migration (`cli_pairing_requests` table + `api_keys.source/expires_at/permissions` columns), helpdesk role permissions, a `LOOPS_CLI_PAIRING_APPROVED_TRANSACTIONAL_ID` transactional email, and an undocumented `SUPABASE_JWT_SECRET` requirement. |

---

## Suggested Review Order
1. `src/client/stream.ts` — start here: the SSE parsing engine everything chat-related builds on.
2. `src/sync/diff.ts` — the second nucleus: pure diff algorithm behind sources sync.
3. `src/client/chat-helpers.ts` — thin layer joining the parser to `sendChat`/`retryChat`.
4. `src/client/client.ts` — per-call `AbortSignal` support needed for Ctrl-C cancellation.
5. `src/commands/chat/index.ts` — one-shot chat and the REPL launcher.
6. `src/repl/chat-repl.ts` — interactive REPL loop and Ctrl-C semantics.
7. `src/commands/chat/retry.ts` — smaller sibling of one-shot chat.
8. `src/sync/execute.ts` — concurrency-pooled executor built on the diff plan.
9. `src/sync/render.ts` — plan-preview rendering.
10. `src/commands/sources/sync.ts` — orchestrates diff/render/execute with the confirmation gate.
11. `src/client/pairing.ts` — pairing protocol client.
12. `src/commands/auth/login.ts` — browser login flow and picker UI.
13. `src/commands/auth/status.ts` — consumes the expanded `/me` contract.
14. `src/commands/auth/logout.ts` — server-side key revocation.
15. `spec/openapi.json` (diff header only) — confirm the 4 new / 1 removed paths match the client code.
16. `.github/workflows/release.yml` — release/publish gating.
17. `tests/e2e/smoke.e2e.ts` — what actually runs against staging before a release ships.

---

## Dependency Tree

```
CLI commands (entry points)
├── commands/chat/index.ts  (chatbase chat — one-shot + REPL launcher)
│   ├── base/body-input.ts → readStdinToEnd()                  [shared util, also used by auth login]
│   ├── client/chat-helpers.ts → sendChat(), fetchRecentHistory()
│   │   ├── client/stream.ts → parseSseStream()                [SSE engine — core]
│   │   └── client/client.ts → throwIfError(), per-call AbortSignal
│   ├── output/spinner.ts → startSpinner('Typing…')
│   └── repl/chat-repl.ts → runChatRepl()
│       └── send/retry callbacks close over chat-helpers.ts above
│
├── commands/chat/retry.ts  (chatbase chat retry)
│   ├── client/chat-helpers.ts → retryChat()
│   └── output/spinner.ts → startSpinner()
│
├── commands/sources/sync.ts  (chatbase sources sync — core consumer)
│   ├── config/project.ts → findProjectConfig()  (sync.dir/include/exclude)
│   ├── sync/diff.ts → scanDir(), computeSyncPlan()            [pure engine — core]
│   ├── sync/render.ts → renderPlan()
│   ├── sync/execute.ts → executeSyncPlan()
│   │   └── client/files.ts → uploadFileSource()               [response-shape fix]
│   └── base/sources.ts → listAllSources(), renderStatus()      [glyph fixes]
│
├── commands/sources/create.ts, update.ts
│   ├── client/files.ts → uploadFileSource()
│   └── output/spinner.ts → startSpinner('Uploading…')
│
├── commands/sources/delete.ts
│   └── base/sources.ts → renderStatus()  [restore-hint fix]
│
├── commands/auth/login.ts  (chatbase auth login — core consumer)
│   ├── client/pairing.ts → startPairing(), pollExchange()      [pairing engine — core]
│   ├── client/client.ts → createApiClient(), throwIfError()
│   ├── base/body-input.ts → readStdinToEnd()  (--with-token)
│   └── config/store.ts → apiKeySource: 'pairing'
│
├── commands/auth/logout.ts
│   ├── client/client.ts → .DELETE('/me/credential')            [external: new spec path]
│   └── config/store.ts → apiKeySource check
│
└── commands/auth/status.ts
    ├── client/client.ts → .GET('/me')                          [external: expanded /me contract]
    └── base/base-command.ts → HTML-vs-JSON error classification

spec/openapi.json + generated/api.d.ts
    — typed contract underlying every client/*.ts call above
    (+ /me, /cli/pairing, /cli/pairing/exchange, /me/credential; − tool-result)

Release & CI (independent layer)
├── .github/workflows/release.yml → release-please + npm publish --provenance   [external: NPM_TOKEN]
├── .github/workflows/ci.yml → Windows matrix + README drift check
├── .github/workflows/e2e.yml → npm run test:e2e                                [external: CHATBASE_E2E_* secrets]
│   └── tests/e2e/smoke.e2e.ts → execFileSync(bin/run.js) against staging       [external: real API]
├── vitest.config.ts → argv-based include/exclude split (default vs e2e run)
├── release-please-config.json + .release-please-manifest.json
└── .gitattributes → LF normalization (fixes Windows CI lint)
```

### Key cross-cutting flows

- **Chat streaming:** `commands/chat/index.ts` → `client/chat-helpers.ts::sendChat` → `client/stream.ts::parseSseStream` → `repl/chat-repl.ts` (REPL reuses the same send/retry)
- **Sync pipeline:** `commands/sources/sync.ts` → `sync/diff.ts::computeSyncPlan` → `sync/render.ts::renderPlan` (preview) → `sync/execute.ts::executeSyncPlan` → `client/files.ts::uploadFileSource`
- **Auth pairing:** `commands/auth/login.ts` → `client/pairing.ts::startPairing/pollExchange` → `config/store.ts` (`apiKeySource`) → `commands/auth/logout.ts` (revoke via new `/me/credential`)
- **Per-call cancellation:** `repl/chat-repl.ts` (AbortController per turn on Ctrl-C) → `client/client.ts` (`signal` merged into `AbortSignal.any`) → `client/stream.ts` (reader released in `finally`)

---

## Deployment Notes
- **New GitHub Actions secrets required**: `NPM_TOKEN` (npm publish with provenance in `release.yml`), `CHATBASE_E2E_API_URL`, `CHATBASE_E2E_API_KEY`, `CHATBASE_E2E_AGENT_ID` (staging E2E smoke suite in `e2e.yml`).
- **npm publish/release configuration added**: `release-please-config.json`, `.release-please-manifest.json` (seeds `0.1.0`), `release.yml`'s gated `npm publish --provenance --access public`, and a `repository` field in `package.json` (provenance requires it).
- **API surface change**: `spec/openapi.json`/`api.d.ts` add `/me`, `/me/credential`, `/cli/pairing`, `/cli/pairing/exchange` and remove `/agents/{agentId}/conversations/{conversationId}/tool-result` (the backing `tools submit-result` command was removed).
- **Pending server-side DB migration** (flagged in `docs/launch-checklist.md`, not part of this diff, needs to be applied separately per this org's Drizzle migrations repo): a new `cli_pairing_requests` table plus `api_keys.source`/`expires_at`/`permissions` columns, along with RLS policies on the new table.
- **New/undocumented environment variables flagged for the server**: `LOOPS_CLI_PAIRING_APPROVED_TRANSACTIONAL_ID` (Loops "device paired" transactional email) and `SUPABASE_JWT_SECRET` (currently undocumented in `.env.example` but required — its absence causes a 500).
- **CI behavior change**: `ci.yml` now fails the build on README drift (`npx oclif readme && git diff --exit-code README.md`) and adds a `windows-latest` matrix leg.
