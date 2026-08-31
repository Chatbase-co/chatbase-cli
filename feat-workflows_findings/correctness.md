# agent: correctness
# model: opus
# findings: 5

| # | Agent | Issue | Location | Symbol | Confidence |
|---|-------|-------|----------|--------|------------|
| 1 | correctness | REPL `/retry` sends `messageId: 'last'`, a sentinel the retry endpoint does not implement — every `/retry` fails with RETRY_MESSAGE_NOT_FOUND | `src/commands/chat/index.ts:201` | `retry` | 90 |
| 2 | correctness | `auth status` branches on error codes `API_KEY_EXPIRED` / `PERMISSION_DENIED` that the API never emits (real codes are `AUTH_EXPIRED_API_KEY` / `AUTH_INSUFFICIENT_PERMISSIONS`) — both new branches are dead | `src/commands/auth/status.ts:96` | `run` | 88 |
| 3 | correctness | Sync change detection compares local raw file bytes against remote source `size`, which for file sources is the extracted-text byte size — non-plain-text files re-upload on every run | `src/sync/diff.ts:168` | `computeSyncPlan` | 84 |
| 4 | correctness | SSE parser drops `error` events and no caller reads `finishReason`, so a server-side stream failure prints nothing and the command exits 0 | `src/client/stream.ts:60` | `parseSseStream` | 80 |
| 5 | correctness | `--include`/`--exclude` narrow the local scan but not the delete set, so remote sources whose local files still exist but are filtered out get planned for deletion | `src/sync/diff.ts:175` | `computeSyncPlan` | 76 |

## Details

### 1. REPL `/retry` sends a `messageId` sentinel the server does not support
`src/commands/chat/index.ts:201`
Confidence: 90

The REPL's retry dep passes `messageId: 'last'` with a comment claiming the server interprets it as the last message, but the retry handler resolves it via an exact `messages.findIndex((m) => m.id === messageId)` (chatbase `src/lib/services/chat/truncate-conversation.ts:40`) and the route schema is a plain `z.string().min(1)` with no sentinel — so `/retry` in the interactive REPL returns RETRY_MESSAGE_NOT_FOUND for every user. The REPL tests inject a fake `retry` dep, so the literal is never exercised.

Suggestion: track the assistant message id returned by the previous turn (it is already in the stream's `message-start` / finish metadata) and pass that real id, or add a documented `last` sentinel to the server route before shipping the slash command.

### 2. `auth status` checks error codes the API never returns
`src/commands/auth/status.ts:96`
Confidence: 88

The new 401/403 disambiguation tests for `API_KEY_EXPIRED` and `PERMISSION_DENIED`, but the v2 API emits `AUTH_EXPIRED_API_KEY` (401) and `AUTH_INSUFFICIENT_PERMISSIONS` (403) in the `{ error: { code } }` envelope, so an expired CLI-paired key always falls through to the generic "Key appears invalid or lacks API access" — the exact message this PR set out to disambiguate. Neither branch has a test.

Suggestion: match on `AUTH_EXPIRED_API_KEY` and `AUTH_INSUFFICIENT_PERMISSIONS` and add a test per branch that feeds the real error body.

### 3. Sync compares two different size quantities
`src/sync/diff.ts:168`
Confidence: 84

`scanDir` records `fs.statSync(abs).size` (raw file bytes) while remote `SourceItem.size` for file sources is the byte size of the *extracted text* (the dashboard file flow writes `calculateByteSize(text)` into the same column the list endpoint reads back). For the PDF/DOCX/DOC/HTML entries in `DEFAULT_INCLUDE` those two numbers essentially never coincide, so every such file is classified `update` on every run: the plan reports "~N updated" for an unchanged tree, `--dry-run` misreports, and each sync re-uploads and re-marks the sources as needing retraining. There is also no escape hatch for the inverse case (a same-size content edit is reported unchanged) — `--force` only skips the confirmation prompt, despite the `SyncPlan` docblock describing it as "re-upload everything".

Suggestion: diff on a stable identity the server also exposes (a content hash or `updatedAt`), or drop size comparison and make `--force` actually re-upload matched files as the docblock claims.

### 4. Stream `error` events and error finish reasons are silently discarded
`src/client/stream.ts:60`
Confidence: 80

The stream protocol documented in the regenerated spec includes `error` — `{ type, errorText }` — and `ChatResponse.metadata.finishReason` can be `error`; the parser ignores unknown types (including `error`) and, while it forwards `finishReason` in the metadata event, neither `handleResponse` nor the chat/retry commands inspect it. A generation that fails mid-stream therefore ends as a normal stream close: the command prints whatever partial text arrived and exits 0, so a script cannot distinguish a failed answer from a successful one.

Suggestion: map `type === 'error'` to a `StreamEvent` that `handleResponse` throws on, and treat `finishReason === 'error'` as a non-zero exit for both the streaming and non-streaming paths.

### 5. Include/exclude filters shrink the local set but not the delete set
`src/sync/diff.ts:175`
Confidence: 76

`computeSyncPlan` deletes every remote file source whose name is not in `local`, and `local` has already been narrowed by the include/exclude globs. So adding `--exclude '**/drafts/**'` (or the `sync.exclude` example in `parseSyncConfig`'s comment), or narrowing `--include` to one extension, plans deletion of the previously synced remote sources for files that still exist on disk — the opposite of what a filter normally means. The confirmation prompt lists the deletions, and trained sources land in restorable `toBeDeleted`, but untrained ones are hard-deleted.

Suggestion: either scope the delete set to remote names that match the include/exclude globs, or state the destructive semantics in the flag descriptions and in `computeSyncPlan`'s docblock.
