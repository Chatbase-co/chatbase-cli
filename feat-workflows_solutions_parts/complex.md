# Tier: Complex — verified solutions (issues #1, #4, #7, #11, #17, #26)

All six assigned issues survived the FP gate. Diff-scope is unambiguous: `src/commands/chat/index.ts` (238/0), `src/client/stream.ts` (85/0) and `src/sync/diff.ts` (182/0) are **net-new files** added by this branch (`git diff origin/feat/full-coverage...HEAD --numstat`), and `src/commands/auth/status.ts`'s two dead branches were introduced by commit `9f4f97b` on this branch.

## False Positives Identified

| Original # | Issue | Verdict | Reason |
|-------------|-------|---------|--------|
| — | — | — | None. All six assigned issues were confirmed against server source, the generated contract, and `node_modules/ai@5.0.117`. |

### Reduced Severity

| Original # | Issue | Old → New Confidence | Reason |
|-------------|-------|---------------------|--------|
| — | — | — | No reductions. |

### Increased Severity

| Original # | Issue | Old → New Confidence | Reason |
|-------------|-------|---------------------|--------|
| 11 | SSE parser drops `error` events; `finishReason` never read | 80 → **86** | Two independent confirmations found during verification. (a) The server genuinely emits `{ type: 'error', errorText }` — `node_modules/ai/dist/index.mjs:5628-5634` enqueues it from `toUIMessageStream`, which `buildStreamingChatResponse` (`src/lib/api/shared/chat-response.ts:54`) uses. (b) `finishReason` is not merely unread — it is read from the **wrong field**: the parser looks at `part.messageMetadata.finishReason`, but the AI SDK puts it at the top level of the finish chunk (`{ type: 'finish', finishReason, messageMetadata }`, `index.mjs:5655-5661`) and the server's `messageMetadata` (`chat-response.ts:76-84`) contains only `messageId`/`userMessageId`/`conversationId`/`userId`/`usage`. So the field is dead twice over. Matches the confidence the chaos agent independently assigned to the same defect (#3, 88). |

---

## Critical Issues (90-100)

---

### #1 — REPL `/retry` sends `messageId: 'last'`, a sentinel the retry endpoint does not implement

*(Merged: covers duplicate issue **#10** — code-quality found the same defect from the contract side.)*

| | |
|---|---|
| **Agent** | correctness (+ code-quality) |
| **Confidence** | 90 |
| **Location** | `src/commands/chat/index.ts:201` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`runInteractive`'s `retry` closure hardcodes `messageId: 'last'`. Traced end to end on the server: `chatRetryHandler` (`/Users/alyelnaggar/work/chatbase/src/lib/api/v2/routes/chatbots/chat-retry.handler.ts:61-73`) passes `messageId` straight into `truncateConversation`, which does `messages.findIndex((m) => m.id === messageId)` (`/Users/alyelnaggar/work/chatbase/src/lib/services/chat/truncate-conversation.ts:41`). No message ever has the id `'last'`, so the index is `-1` → `code: 'message-not-found'` → `APIError(CHAT_ERRORS.RETRY_MESSAGE_NOT_FOUND)` → HTTP 404. `grep -rn "'last'"` across the server repo's retry path and `RetryRequest` in `spec/openapi.json` (`minLength: 1`, `example: "msg-abc123"`) confirms no sentinel exists anywhere. Every `/retry` in the REPL fails.

The comment at `src/commands/chat/index.ts:188-190` states the premise that is false: *"we use 'last' as a placeholder that the server interprets as the last message in the conversation."*

The fix is available for free: the streaming response already carries the assistant message id. `buildStreamingChatResponse` (`/Users/alyelnaggar/work/chatbase/src/lib/api/shared/chat-response.ts:76-84`) emits `messageMetadata: { messageId, userMessageId, conversationId, userId, usage }` on the `finish` part — the same object the parser already mines for `conversationId`. Retrying at the **assistant** message id is exactly right for this endpoint: the handler truncates at that message and re-sends the preceding user message.

#### Before

```typescript
// src/client/stream.ts:8-11
export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
    | { type: 'done' }
```

```typescript
// src/client/stream.ts:65-78
                    } else if (
                        part.type === 'message-metadata' ||
                        part.type === 'finish'
                    ) {
                        const meta = (part.messageMetadata ?? {}) as {
                            conversationId?: string
                            finishReason?: string
                        }
                        onEvent({
                            type: 'metadata',
                            conversationId: meta.conversationId,
                            finishReason: meta.finishReason
                        })
                    }
```

```typescript
// src/client/chat-helpers.ts:22-27
/** raw is the typed non-streaming envelope (from the generated OpenAPI
 * types); present only when the call was made with stream: false. */
export type ChatResult = {
    conversationId?: string
    raw?: ChatResponseEnvelope
}
```

```typescript
// src/client/chat-helpers.ts:37-57
    if (!stream) {
        throwIfError(response, error)
        const raw = data as unknown as ChatResponseEnvelope
        return { raw, conversationId: raw?.data?.metadata?.conversationId }
    }

    // With parseAs: 'stream', openapi-fetch drains the body into `error`
    // on non-2xx — re-reading response.json() would throw (already consumed).
    if (!response.ok) throwIfError(response, error)

    const body = data as unknown as ReadableStream<Uint8Array> | null
    if (!body) throw new Error('Stream response had no body')

    let conversationId: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(event.text)
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
        }
    })
    return { conversationId }
```

```typescript
// src/commands/chat/index.ts:162-213
        const send = async (
            message: string,
            conversationId?: string,
            signal?: AbortSignal
        ): Promise<{ conversationId?: string }> => {
            const stop = spinUntilFirstToken()
            try {
                const { conversationId: nextId } = await sendChat({
                    client,
                    agentId,
                    message,
                    conversationId,
                    stream: true,
                    signal,
                    onText: (text) => {
                        stop()
                        process.stdout.write(text)
                    }
                })
                process.stdout.write('\n')
                return { conversationId: nextId }
            } finally {
                stop()
            }
        }

        // Retries the last message in the conversation. Since the REPL doesn't
        // track individual message IDs, we use "last" as a placeholder that
        // the server interprets as the last message in the conversation.
        const retry = async (
            conversationId: string,
            signal?: AbortSignal
        ): Promise<void> => {
            const stop = spinUntilFirstToken()
            try {
                await retryChat({
                    client,
                    agentId,
                    conversationId,
                    messageId: 'last',
                    stream: true,
                    signal,
                    onText: (text) => {
                        stop()
                        process.stdout.write(text)
                    }
                })
                process.stdout.write('\n')
            } finally {
                stop()
            }
        }
```

#### After

```typescript
// src/client/stream.ts:8-11
export type StreamEvent =
    | { type: 'text'; text: string }
    | {
          type: 'metadata'
          conversationId?: string
          messageId?: string
          finishReason?: string
      }
    | { type: 'done' }
```

```typescript
// src/client/stream.ts:65-79
                    } else if (
                        part.type === 'message-metadata' ||
                        part.type === 'finish'
                    ) {
                        const meta = (part.messageMetadata ?? {}) as {
                            conversationId?: string
                            messageId?: string
                        }
                        onEvent({
                            type: 'metadata',
                            conversationId: meta.conversationId,
                            messageId: meta.messageId,
                            // The AI SDK puts finishReason at the top level of
                            // the `finish` chunk, not inside messageMetadata.
                            finishReason: part.finishReason as
                                | string
                                | undefined
                        })
                    }
```

```typescript
// src/client/chat-helpers.ts:22-28
/** raw is the typed non-streaming envelope (from the generated OpenAPI
 * types); present only when the call was made with stream: false.
 * messageId is the assistant message the server just produced — the id
 * `chat retry` / the REPL's /retry must pass back. */
export type ChatResult = {
    conversationId?: string
    messageId?: string
    raw?: ChatResponseEnvelope
}
```

```typescript
// src/client/chat-helpers.ts:37-59
    if (!stream) {
        throwIfError(response, error)
        const raw = data as unknown as ChatResponseEnvelope
        return {
            raw,
            conversationId: raw?.data?.metadata?.conversationId,
            messageId: raw?.data?.id
        }
    }

    // With parseAs: 'stream', openapi-fetch drains the body into `error`
    // on non-2xx — re-reading response.json() would throw (already consumed).
    if (!response.ok) throwIfError(response, error)

    const body = data as unknown as ReadableStream<Uint8Array> | null
    if (!body) throw new Error('Stream response had no body')

    let conversationId: string | undefined
    let messageId: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(event.text)
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
            messageId = event.messageId ?? messageId
        }
    })
    return { conversationId, messageId }
```

```typescript
// src/commands/chat/index.ts:162-217
        // The server returns the assistant message id in the stream's
        // finish metadata — remember it so /retry has a real id to send
        // (the retry endpoint truncates at that message and re-sends the
        // user message before it; there is no "last" sentinel).
        let lastMessageId: string | undefined

        const send = async (
            message: string,
            conversationId?: string,
            signal?: AbortSignal
        ): Promise<{ conversationId?: string }> => {
            const stop = spinUntilFirstToken()
            try {
                const { conversationId: nextId, messageId } = await sendChat({
                    client,
                    agentId,
                    message,
                    conversationId,
                    stream: true,
                    signal,
                    onText: (text) => {
                        stop()
                        process.stdout.write(text)
                    }
                })
                lastMessageId = messageId ?? lastMessageId
                process.stdout.write('\n')
                return { conversationId: nextId }
            } finally {
                stop()
            }
        }

        const retry = async (
            conversationId: string,
            signal?: AbortSignal
        ): Promise<void> => {
            if (!lastMessageId) {
                throw new UsageError(
                    'Nothing to retry yet in this session — send a message first, ' +
                        'or use `chatbase chat retry --conversation <id> --message-id <id>`.'
                )
            }
            const stop = spinUntilFirstToken()
            try {
                const { messageId } = await retryChat({
                    client,
                    agentId,
                    conversationId,
                    messageId: lastMessageId,
                    stream: true,
                    signal,
                    onText: (text) => {
                        stop()
                        process.stdout.write(text)
                    }
                })
                lastMessageId = messageId ?? lastMessageId
                process.stdout.write('\n')
            } finally {
                stop()
            }
        }
```

`UsageError` is already imported at `src/commands/chat/index.ts:12`. The REPL's `cancelable()` (`src/repl/chat-repl.ts:82-103`) catches the throw and prints `✗ <message>` without killing the session, so the guard degrades gracefully.

#### Alternative approach
The guard above still leaves one hole: `chatbase chat -a X --conversation conv_1` seeds `initialConversationId`, so `/retry` passes the REPL's `if (!conversationId)` check on the very first turn but has no `lastMessageId`. To make that case work, look the id up instead of erroring — `GET /agents/{agentId}/conversations/{conversationId}/messages` returns `ConversationMessage.id` (required field in `spec/openapi.json`), and `fetchRecentHistory` already calls that endpoint. Add `id` to `HistoryLine`, then in the `!lastMessageId` branch fetch the tail and take the last `role === 'assistant'` entry. Trade-off: one extra round trip on a cold `/retry`, versus a REPL that silently can't retry a resumed conversation.

---

## Important Issues (75-89)

---

### #4 — `auth status` branches on error codes the API never emits

| | |
|---|---|
| **Agent** | correctness |
| **Confidence** | 88 |
| **Location** | `src/commands/auth/status.ts:96` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
Commit `9f4f97b` ("fix: auth status distinguishes expired/permission-denied from invalid key on 401/403") added two branches keyed on `code === 'API_KEY_EXPIRED'` and `code === 'PERMISSION_DENIED'`. Neither string exists in the API's error vocabulary — `AUTH_ERRORS` (`/Users/alyelnaggar/work/chatbase/src/lib/api/v2/errors/auth.ts:18-31`) defines `AUTH_EXPIRED_API_KEY` (401) and `AUTH_INSUFFICIENT_PERMISSIONS` (403). Both branches are unreachable; every 401/403 falls through to the generic "Key appears invalid or lacks API access."

Verification also turned up a second defect the finding did not catch: renaming `PERMISSION_DENIED` → `AUTH_INSUFFICIENT_PERMISSIONS` would **still** be dead code. `requiredPermissionFor` returns `null` for `/me` — *"Returns `null` only for `/me` — any valid key may introspect itself"* (`/Users/alyelnaggar/work/chatbase/src/lib/api/v2/middleware/key-permission-guard.ts:29`) — so `keyPermissionGuardMiddleware` can never throw `INSUFFICIENT_PERMISSIONS` on this route. The only 403 `/me` documents is `SUBSCRIPTION_API_RESTRICTED_PLAN` (`spec/openapi.json`, `/me` → 403 example), which also makes the current message text ("Check scopes with your workspace admin") wrong — the real cause is a plan restriction, not a scope.

#### Before
```typescript
// src/commands/auth/status.ts:91-117
        } else if (response.status === 401 || response.status === 403) {
            const errBody = error as {
                error?: { code?: string }
            } | null
            const code = errBody?.error?.code
            if (code === 'API_KEY_EXPIRED') {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Key has expired — re-pair with `chatbase auth login --browser`'
                    )
                )
            } else if (code === 'PERMISSION_DENIED') {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Key lacks permission for this operation. Check scopes with your workspace admin.'
                    )
                )
            } else {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Key appears invalid or lacks API access.'
                    )
                )
            }
```

#### After
```typescript
// src/commands/auth/status.ts:91-117
        } else if (response.status === 401 || response.status === 403) {
            const errBody = error as {
                error?: { code?: string }
            } | null
            const code = errBody?.error?.code
            if (code === 'AUTH_EXPIRED_API_KEY') {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Key has expired — re-pair with `chatbase auth login --browser`'
                    )
                )
            } else if (code === 'SUBSCRIPTION_API_RESTRICTED_PLAN') {
                // /me is scope-exempt (requiredPermissionFor returns null),
                // so the only 403 it can return is the plan restriction.
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! This workspace’s plan does not include API access — a Standard plan or higher is required.'
                    )
                )
            } else {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Key appears invalid or lacks API access.'
                    )
                )
            }
```

#### Alternative approach
Rather than string literals scattered per command, derive the codes from the generated contract so a rename in `spec/openapi.json` becomes a compile error. The spec's `/me` 401/403 responses carry `ErrorResponse` with the codes in `example`, so a small `src/errors/codes.ts` exporting `const AUTH_EXPIRED_API_KEY = 'AUTH_EXPIRED_API_KEY' as const` plus a regeneration check is a cheap guard — the same class of drift that produced this bug.

---

### #11 (+#3, +#25) — SSE parser silently discards every failure signal

*(Merged: this one fix covers **#11** (correctness, 80 → 86), **#3** (chaos, 88) and **#25** (logging, 76) — the review's own overlap section groups all three under `parseSseStream`.)*

| | |
|---|---|
| **Agent** | correctness (+ chaos, logging) |
| **Confidence** | **86** (raised from 80 — see Increased Severity table) |
| **Location** | `src/client/stream.ts:60` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`parseSseStream`'s if/else chain matches exactly two part types: `text-delta`, and `message-metadata`/`finish`. Everything else is dropped on the floor. The one that matters is `{ type: 'error', errorText }` — confirmed emitted by the server: `buildStreamingChatResponse` (`/Users/alyelnaggar/work/chatbase/src/lib/api/shared/chat-response.ts:54`) calls `toUIMessageStreamResponse`, and `toUIMessageStream` enqueues `{ type: 'error', errorText: onError(part.error) }` (`node_modules/ai/dist/index.mjs:5628-5634`, `ai@5.0.117`).

A mid-generation failure therefore arrives on an already-200 response (headers long since sent, so `throwIfError` at `chat-helpers.ts:45` is a no-op), gets ignored by the parser, the stream then closes normally, `handleResponse` returns `{ conversationId }`, `Chat.run` writes `'\n'` and the conversation hint, and the process **exits 0** with truncated output. A script piping `chatbase chat -m ...` cannot tell a half-answer from a whole one.

The finding's second half is also true, and worse than stated: `finishReason` has no consumer (`grep -rn finishReason src/ tests/` → only `stream.ts` itself and the generated types), *and* it is read from the wrong location. The parser reads `part.messageMetadata.finishReason`, but the AI SDK puts it at the top level — `{ type: 'finish', finishReason, messageMetadata }` (`index.mjs:5655-5661`) — and the server's `messageMetadata` payload is `{ messageId, userMessageId, conversationId, userId, usage }` with no `finishReason` at all. The field is permanently `undefined`.

No mitigation exists anywhere on the path: the 60s idle timeout does not fire (the error part *is* data, and the server closes immediately after), and `cancelable()` in the REPL only sees rejections, of which there are none.

#### Before
```typescript
// src/client/stream.ts:8-11
export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
    | { type: 'done' }
```

```typescript
// src/client/stream.ts:54-78
                    let part: Record<string, unknown>
                    try {
                        part = JSON.parse(payload) as Record<string, unknown>
                    } catch {
                        continue
                    }
                    if (
                        part.type === 'text-delta' &&
                        typeof part.delta === 'string'
                    ) {
                        onEvent({ type: 'text', text: part.delta })
                    } else if (
                        part.type === 'message-metadata' ||
                        part.type === 'finish'
                    ) {
                        const meta = (part.messageMetadata ?? {}) as {
                            conversationId?: string
                            finishReason?: string
                        }
                        onEvent({
                            type: 'metadata',
                            conversationId: meta.conversationId,
                            finishReason: meta.finishReason
                        })
                    }
```

```typescript
// src/client/chat-helpers.ts:50-57
    let conversationId: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(event.text)
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
        }
    })
    return { conversationId }
```

#### After
```typescript
// src/client/stream.ts:8-12
export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
    /** A server-side generation failure delivered mid-stream (the response
     * is already 200, so this is the only failure signal there is). */
    | { type: 'error'; message: string }
    /** A `data:` payload that was not valid JSON — the stream continues, but
     * the caller should say so rather than present a silent gap. (#25) */
    | { type: 'warning'; message: string }
    | { type: 'done' }
```

```typescript
// src/client/stream.ts:54-83
                    let part: Record<string, unknown>
                    try {
                        part = JSON.parse(payload) as Record<string, unknown>
                    } catch {
                        onEvent({
                            type: 'warning',
                            message: 'Skipped an unparseable stream chunk'
                        })
                        continue
                    }
                    if (
                        part.type === 'text-delta' &&
                        typeof part.delta === 'string'
                    ) {
                        onEvent({ type: 'text', text: part.delta })
                    } else if (part.type === 'error') {
                        onEvent({
                            type: 'error',
                            message:
                                typeof part.errorText === 'string'
                                    ? part.errorText
                                    : 'The agent stopped with an error'
                        })
                    } else if (
                        part.type === 'message-metadata' ||
                        part.type === 'finish'
                    ) {
                        const meta = (part.messageMetadata ?? {}) as {
                            conversationId?: string
                        }
                        onEvent({
                            type: 'metadata',
                            conversationId: meta.conversationId,
                            // finishReason rides on the finish chunk itself,
                            // not inside messageMetadata.
                            finishReason: part.finishReason as
                                | string
                                | undefined
                        })
                    }
```

```typescript
// src/client/chat-helpers.ts:50-63
    let conversationId: string | undefined
    let streamError: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(event.text)
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
        }
        if (event.type === 'warning') {
            process.stderr.write(`! ${event.message}\n`)
        }
        if (event.type === 'error') streamError = event.message
    })
    if (streamError) throw new Error(streamError)
    return { conversationId }
```

Recording the error and throwing **after** the stream drains (rather than throwing from inside `onEvent`) keeps `parseSseStream`'s `finally { reader.cancel() }` on its normal path and lets any text that arrived before the error still reach the user. `Chat.run`'s `try/finally` stops the spinner, `BaseCommand.catch` classifies it as `unexpected` and exits 1; in the REPL, `cancelable()` prints `✗ <errorText>` and returns to the prompt.

**Trade-off / follow-up:** partial text already streamed to stdout has no trailing newline when the throw happens, so the stderr error will start on the same visual line in the one-shot path. If that matters, write a `'\n'` to stdout immediately before the throw when any text was emitted.

**Note on `finishReason`:** with the location corrected it now carries a real value, but still has no consumer. Either wire it (e.g. warn when `finishReason === 'error'` or `'tool-calls'` in the non-streaming path, where `ChatResponse.metadata.finishReason` is a *required* field per `spec/openapi.json`) or drop it from `StreamEvent` — leaving a plumbed-but-unread field is what let the wrong-field bug live undetected.

---

### #7 — Sync change detection compares local raw bytes against the remote *extracted-text* size

| | |
|---|---|
| **Agent** | correctness |
| **Confidence** | 84 |
| **Location** | `src/sync/diff.ts:168` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`computeSyncPlan` decides "changed" with `r.size !== l.size`, where `l.size` is `fs.statSync(abs).size` (raw bytes on disk, `diff.ts:116`) and `r.size` is the API's `SourceListItem.size`. Those measure different things for file sources. Evidence from the server:

- `FILE_SOURCE_METADATA_SCHEMA` (`/Users/alyelnaggar/work/chatbase/src/lib/schemas/source.schema.ts:206-217`) carries `originalSize` **and** `processedSize` as fields *separate from* the top-level `size` column — `originalSize` would be redundant if `size` were the raw upload.
- The dashboard's file-source save path sets `size = calculateByteSize(text)` on the extracted text (`/Users/alyelnaggar/work/chatbase/src/app/(main)/(app)/dashboard/[accountSlug]/chatbot/[chatId]/sources/files/_hooks/use-file-form.ts:73`), so even if the initial upload stored raw bytes, any later edit overwrites `size` with text bytes.
- `sources.size` is what `checkChatbotSizeLimit` sums for the account's text-content quota (`sources.server.ts:1230-1240`).

`DEFAULT_INCLUDE` (`diff.ts:24-33`) contains `**/*.pdf`, `**/*.docx`, `**/*.doc`, `**/*.html` — for all of these the extracted text is far smaller than the file, so `r.size !== l.size` is true on **every** run: the plan permanently shows `~ report.pdf`, `unchanged` stays 0, the file is re-uploaded, and the source is re-marked `updated` (requiring retraining) each time. Sync never converges. Even plain `.txt` is not safe: a CRLF file on Windows (this PR adds a Windows CI matrix) has more raw bytes than its LF-normalised extracted text.

There is no stateless escape hatch. I checked whether `originalSize` leaks through the API: it does not — `toSourceRow` in `/Users/alyelnaggar/work/chatbase/src/lib/services/sources.server.ts:602-619` returns `metadata: null` for every non-`link` type, and `SourceListItem.metadata` is documented as *"Link-specific metadata. Present only for type=\"link\""*. The list response exposes no hash, no `updatedAt`, and no raw size.

The minimal correct fix is therefore a **local fingerprint cache**. It belongs in `cacheDir()`, which the CLI already documents as *"disposable — cleanup tools may purge it anytime"* (`src/config/paths.ts:4`) — exactly the right semantics: if the cache is missing, behaviour degrades to today's size comparison, never to incorrect data. `computeSyncPlan` stays pure; the map is injected.

#### Before
```typescript
// src/sync/diff.ts:139-142
export function computeSyncPlan(
    local: LocalFile[],
    remote: SourceItem[]
): SyncPlan {
```

```typescript
// src/sync/diff.ts:161-173
    const create: LocalFile[] = []
    const update: Array<LocalFile & { sourceId: string }> = []
    let unchanged = 0
    for (const l of local) {
        const r = remoteByName.get(l.relPath)
        if (!r) {
            create.push(l)
        } else if (r.size !== l.size) {
            update.push({ ...l, sourceId: r.id })
        } else {
            unchanged++
        }
    }
```

#### After
```typescript
// src/sync/diff.ts:139-143
/** relPath → the local byte size that was last successfully uploaded. */
export type UploadedSizes = ReadonlyMap<string, number>

export function computeSyncPlan(
    local: LocalFile[],
    remote: SourceItem[],
    uploaded?: UploadedSizes
): SyncPlan {
```

```typescript
// src/sync/diff.ts:161-178
    const create: LocalFile[] = []
    const update: Array<LocalFile & { sourceId: string }> = []
    let unchanged = 0
    for (const l of local) {
        const r = remoteByName.get(l.relPath)
        if (!r) {
            create.push(l)
            continue
        }
        // The remote `size` is the EXTRACTED TEXT size for file sources, not
        // the raw upload — comparing it to l.size marks every PDF/DOCX as
        // changed forever. Prefer the size we recorded at upload time; only
        // fall back to the (unreliable) remote size with no cache entry.
        const previous = uploaded?.get(l.relPath)
        const changed = previous == null ? r.size !== l.size : previous !== l.size
        if (changed) {
            update.push({ ...l, sourceId: r.id })
        } else {
            unchanged++
        }
    }
```

```typescript
// src/sync/cache.ts  (new file)
import fs from 'node:fs'
import path from 'node:path'
import { cacheDir } from '../config/paths.js'

/**
 * Per-agent record of "relPath → local byte size at last successful upload".
 * Lives in cacheDir() because it is a pure optimisation: if it is purged,
 * computeSyncPlan falls back to comparing remote sizes (today's behaviour),
 * which over-reports changes but never under-reports them.
 */
function cacheFile(agentId: string): string {
    return path.join(cacheDir(), 'sync', `${agentId}.json`)
}

export function readUploadedSizes(agentId: string): Map<string, number> {
    try {
        const raw = fs.readFileSync(cacheFile(agentId), 'utf8')
        return new Map(Object.entries(JSON.parse(raw) as Record<string, number>))
    } catch {
        return new Map()
    }
}

export function writeUploadedSizes(
    agentId: string,
    sizes: Map<string, number>
): void {
    try {
        const file = cacheFile(agentId)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(Object.fromEntries(sizes)))
    } catch {
        /* a cache write must never fail the sync */
    }
}
```

```typescript
// src/commands/sources/sync.ts:118-119  (wiring)
        const remote = await listAllSources(client, agentId)
        const uploaded = readUploadedSizes(agentId)
        const plan = computeSyncPlan(local, remote, uploaded)
```

After a successful `executeSyncPlan`, refresh the cache with the sizes that actually landed (skip entries in `result.failures`, drop entries for `plan.del`) and call `writeUploadedSizes(agentId, next)`.

#### Alternative approach
**Server-side, stateless:** add `originalSize` (the raw upload byte count already stored in `sources.metadata`) to `SourceListItem` for `type === 'file'`, then the predicate becomes `r.originalSize !== l.size` with no local state at all. This is the cleaner design and matches the CLAUDE.md rule that API changes are mirrored into the CLI — but it is a two-repo change, needs a `spec/openapi.json` regeneration, and leaves pre-existing sources (whose `metadata.originalSize` may be absent) on the fallback path anyway.

**Do nothing but be honest:** keep the size comparison and document that non-plain-text sources re-upload every run. Rejected — it defeats the point of a converging sync and silently burns retraining cycles.

---

### #17 — Agent-sourced text is written to the terminal with no control-sequence stripping

| | |
|---|---|
| **Agent** | security |
| **Confidence** | 78 |
| **Location** | `src/commands/chat/index.ts:95` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
Three new output paths in this PR write remote-controlled text to the terminal verbatim: the streaming `onText` callbacks (`chat/index.ts:95` one-shot, `chat/index.ts:178` REPL, `chat/retry.ts:53`), the non-streaming text branch `process.stdout.write(\`${extractText(result.raw)}\n\`)` (`chat/index.ts:109`), and the `--resume` history replay `this.note(flags, dim(\`${who}: ${line.text}\`))` (`chat/index.ts:141`). `grep -rn` over `src/` finds escape sequences only in `output/color.ts` and `output/spinner.ts`, both self-generated — there is no sanitizer anywhere on the input side.

The most concrete vector is not LLM behaviour at all, it is `--resume`. `fetchRecentHistory` replays stored **user** messages, whose text a third party controls end to end (widget, API, any integration). Its only transform is `.replace(/\s+/g, ' ')` (`chat-helpers.ts:156`), and `\s` does not match `ESC` (0x1B), `BEL` (0x07) or `DEL` (0x7F). So a support engineer running `chatbase chat -a X --conversation <id> --resume` on a hostile conversation renders attacker bytes into their terminal: OSC 52 clipboard writes, cursor/erase sequences that hide preceding lines, `\r` overwrites. Knowledge-base poisoning reaching the model's output is the same problem one step further out.

`--json` is *not* affected — `JSON.stringify` escapes control characters as `\u001b`-style sequences — which is why the fix belongs at the text boundaries, not globally.

The cleanest choke point is `chat-helpers.ts`: sanitizing there covers the streaming callback, `extractText`, and `fetchRecentHistory` in one place, and automatically covers `chat/retry.ts` too. Sanitizing each streamed delta independently is safe even when a sequence is split across chunk boundaries: stripping the `ESC` byte alone defuses the sequence, and the surviving `[2K` prints as inert ASCII.

#### Before
```typescript
// src/client/chat-helpers.ts:12-20
/**
 * Joins every `text` part of a non-streaming ChatResponse into one string.
 * Tool-call/tool-result parts are skipped.
 */
export function extractText(envelope: ChatResponseEnvelope): string {
    return envelope.data.parts
        .filter((part) => part.type === 'text')
        .map((part) => (part as { text: string }).text)
        .join('')
}
```

```typescript
// src/client/chat-helpers.ts:50-57
    let conversationId: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(event.text)
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
        }
    })
    return { conversationId }
```

```typescript
// src/client/chat-helpers.ts:147-162
    return items.slice(-count).map((m) => {
        const msg = m as {
            role?: string
            parts?: Array<{ type?: string; text?: string }>
        }
        const text = (msg.parts ?? [])
            .filter((p) => p.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text)
            .join('')
            .replace(/\s+/g, ' ')
            .trim()
        return {
            role: msg.role ?? 'unknown',
            text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
        }
    })
```

#### After
```typescript
// src/client/chat-helpers.ts:12-33
/**
 * Strips C0/C1 control characters (keeping only \t and \n) from text that
 * came back from the API. Agent replies and replayed user messages are
 * attacker-influenceable, and raw ESC/OSC bytes reaching a terminal are an
 * injection primitive (OSC 52 clipboard writes, cursor/erase spoofing, \r
 * line overwrites). Safe to apply per streamed chunk: removing the ESC byte
 * defuses a sequence even when it is split across two deltas — the tail
 * prints as inert ASCII. `--json` output is unaffected (JSON.stringify
 * already escapes these), so raw fidelity remains available.
 */
export function sanitizeAgentText(text: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
    return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
}

/**
 * Joins every `text` part of a non-streaming ChatResponse into one string.
 * Tool-call/tool-result parts are skipped.
 */
export function extractText(envelope: ChatResponseEnvelope): string {
    return sanitizeAgentText(
        envelope.data.parts
            .filter((part) => part.type === 'text')
            .map((part) => (part as { text: string }).text)
            .join('')
    )
}
```

```typescript
// src/client/chat-helpers.ts:50-57
    let conversationId: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(sanitizeAgentText(event.text))
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
        }
    })
    return { conversationId }
```

```typescript
// src/client/chat-helpers.ts:147-162
    return items.slice(-count).map((m) => {
        const msg = m as {
            role?: string
            parts?: Array<{ type?: string; text?: string }>
        }
        const text = sanitizeAgentText(
            (msg.parts ?? [])
                .filter((p) => p.type === 'text' && typeof p.text === 'string')
                .map((p) => p.text)
                .join('')
        )
            .replace(/\s+/g, ' ')
            .trim()
        return {
            role: msg.role ?? 'unknown',
            text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
        }
    })
```

#### Alternative approach
Gate the stripping on `process.stdout.isTTY` so piped/redirected output keeps byte-for-byte fidelity. Rejected as the default: a redirected transcript is usually `cat`-ed later, which re-exposes the same terminal, and the CLI already offers `--json` for lossless output. If fidelity matters to a consumer, `--json` is the documented answer.

---

### #26 — `--include`/`--exclude` narrow the local scan but not the delete set

| | |
|---|---|
| **Agent** | correctness |
| **Confidence** | 76 |
| **Location** | `src/sync/diff.ts:175` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`SourcesSync.run` passes the globs only to the scan — `scanDir(dir, { include, exclude })` (`sync.ts:114`) — then calls `computeSyncPlan(local, remote)` (`sync.ts:119`) with no filter. `computeSyncPlan` builds `localRelPaths` from the already-narrowed `local` and deletes every remote file source not in it (`diff.ts:175-179`). Anything the filter excluded looks, to the delete pass, exactly like a file that was removed from disk.

This is reachable on the **default** path, not just with explicit flags: `DEFAULT_INCLUDE` (`diff.ts:24-33`) is eight extensions, so a plain `chatbase sources sync ./docs` on a folder containing `deck.pptx` neither uploads it nor considers it — yet plans a delete for the remote source named `deck.pptx`. The local file is sitting right there. That internal inconsistency is what rules out "intentional strict mirror": under a strict-mirror reading the file would be uploaded, and under a scoped reading it would be left alone; the current code does neither. No test pins the behaviour (`tests/sync/diff.test.ts` only covers a matching-extension delete).

Mitigations exist but are partial: `renderPlan` lists each `− <name>` (`render.ts:23`), `confirmSync` requires a y/N (or a typed agent ID when deletes exceed half the file sources), and trained sources soft-delete to `toBeDeleted` and are restorable. But `--force` — the documented CI mode — skips all of it, and never-trained sources are hard-deleted (`src/commands/sources/delete.ts:29-31`).

The fix is clean because remote sources are keyed by the same `relPath` string the globs match: scope the delete pass with the identical filters `scanDir` used.

#### Before
```typescript
// src/sync/diff.ts:139-150
export function computeSyncPlan(
    local: LocalFile[],
    remote: SourceItem[]
): SyncPlan {
    const remoteFiles = remote.filter(
        (r) =>
            r.type === 'file' &&
            r.status !== 'toBeDeleted' &&
            r.status !== 'deleted'
    )
    const remoteByName = new Map(remoteFiles.map((r) => [r.name, r]))
    const localRelPaths = new Set(local.map((l) => l.relPath))
```

```typescript
// src/sync/diff.ts:175-179
    const del: Array<{ sourceId: string; name: string }> = []
    for (const r of remoteFiles) {
        if (!localRelPaths.has(r.name))
            del.push({ sourceId: r.id, name: r.name })
    }
```

#### After
```typescript
// src/sync/diff.ts:139-155
export function computeSyncPlan(
    local: LocalFile[],
    remote: SourceItem[],
    opts: ScanOptions = {}
): SyncPlan {
    // Resolve exactly as scanDir does, so the delete pass is scoped to the
    // same set of paths the scan considered.
    const include = opts.include ?? DEFAULT_INCLUDE
    const exclude = opts.exclude ?? DEFAULT_EXCLUDE
    const inScope = (name: string): boolean =>
        include.some((p) => matchGlob(p, name)) &&
        !exclude.some((p) => matchGlob(p, name))

    const remoteFiles = remote.filter(
        (r) =>
            r.type === 'file' &&
            r.status !== 'toBeDeleted' &&
            r.status !== 'deleted'
    )
    const remoteByName = new Map(remoteFiles.map((r) => [r.name, r]))
    const localRelPaths = new Set(local.map((l) => l.relPath))
```

```typescript
// src/sync/diff.ts:175-183
    // A remote source only becomes a delete candidate if the current
    // include/exclude filters would have picked its local counterpart up.
    // Otherwise `--include '**/*.md'` (or the default extension list) would
    // delete every remote PDF whose local file is still on disk.
    const del: Array<{ sourceId: string; name: string }> = []
    for (const r of remoteFiles) {
        if (!inScope(r.name)) continue
        if (!localRelPaths.has(r.name))
            del.push({ sourceId: r.id, name: r.name })
    }
```

```typescript
// src/commands/sources/sync.ts:119  (wiring)
        const plan = computeSyncPlan(local, remote, { include, exclude })
```

The existing `tests/sync/diff.test.ts` cases keep passing: `gone.md` matches `**/*.md` and no default exclude, so it still lands in `del`.

Also worth updating: the `computeSyncPlan` docstring (`diff.ts:127-138`) currently explains only the `type`/`status` scoping of the delete set. Add the filter scoping so the next reader does not re-introduce the bug.

`remoteFileCount` in `sync.ts:138-139` is derived as `plan.unchanged + plan.update.length + plan.del.length`, with the comment *"every remote FILE source ends up matched (update/unchanged) or unmatched (del)"*. That invariant still holds after this change — out-of-scope remote sources now fall out of all three buckets, so the high-risk denominator correctly counts only in-scope sources. Worth a comment touch-up there too.

#### Alternative approach
Filter `remote` in the command layer before calling `computeSyncPlan`, keeping the diff function's two-argument signature. Rejected: the globs and their default-resolution logic already live in `diff.ts` next to `scanDir`, and duplicating `matchGlob`/`DEFAULT_INCLUDE` resolution in `sync.ts` is exactly the kind of drift that lets the two halves diverge again.

---

## Cross-references

| My issue | Overlaps with | Handling |
|---|---|---|
| **#1** | **#10** (code-quality, 80) — *assigned to the other agent* | Same defect (`messageId: 'last'`), found from the contract side. Fully covered by the #1 solution above; no separate fix needed. |
| **#11** | **#3** (chaos, 88) and **#25** (logging, 76) — *assigned to the other agent* | All three are the same `parseSseStream` root cause. The merged #11 solution adds the `error` event handling (#3/#11), corrects the `finishReason` field location (#11), and adds the `warning` event for malformed `data:` payloads (#25). One patch closes all three. |
| **#7** and **#26** | each other | Independent root causes (change-detection signal vs. delete-set scoping) that both edit `computeSyncPlan`. The two After blocks compose cleanly: #26 adds the `opts: ScanOptions = {}` third parameter, #7 adds an `uploaded?: UploadedSizes` fourth. If both are applied, land #26 first and append #7's parameter. |
| **#7** and **#9** (chaos, 80 — *other agent*) | related | #9 concerns concurrent-sync duplicates via the `remoteByName` snapshot; it touches the same map but is a distinct concern from the size-comparison signal. No overlap in the fixes. |
| **#17** | **#8/#16** (the `--resume` empty catch — *other agent*) | Both land in the `--resume` history path. #17's fix sanitizes inside `fetchRecentHistory`, so it does not conflict with adding error reporting around the call site in `chat/index.ts:145`. |
