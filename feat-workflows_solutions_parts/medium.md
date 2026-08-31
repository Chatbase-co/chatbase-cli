# PR Review Solutions — Medium Tier

**Assigned issues:** #2, #3, #5, #6, #8, #9, #10, #12, #13, #14, #15, #16, #18, #19, #20, #21, #22, #23, #24, #25, #27

All 21 assigned issues were verified against the actual source (with ≥30 lines of context) and the diff against `origin/feat/full-coverage`. None were false positives — every finding held up under the FP rubric. Two pairs were merged per the review's cross-agent-overlap note (#2+#5, #8+#16), and #10 is recorded as a duplicate cross-reference rather than a second solution for #1.

## False Positives Identified

None. All 21 assigned issues cleared every FP-rubric gate (diff-scope, absolute-language, existing-mitigation, intentional-design, real-fix).

### Reduced Severity

| Original # | Issue | Old → New Confidence | Reason |
|-------------|-------|---------------------|--------|
| 3 | Mid-stream `error` SSE events never matched | 88 → 85 | Core defect (the if/else chain has no branch for `part.type === 'error'`) is fully verified in code; the specific claim that this shape is "documented in the AI SDK UIMessage protocol" is corroborating context I can't independently verify from this repo, so I discount slightly for that unverifiable external citation while keeping the finding Important. |
| 18 | Pairing casts to hand-written literals instead of generated schema types | 78 → 82 | Increased, not reduced — this repo's own history proves the exact failure mode: `verificationUriComplete` was manually added then manually removed from the hand-written cast type across commits `c0dc931`/`de91a78`/`7087456` as the server contract changed, with zero compiler assistance either time. That's live evidence of the drift risk, not a theoretical one. |

---

## Critical Issues (90-100)

---

### #2 & #5 — `printConversationHint` and the spinner/stream/json/text response block are duplicated verbatim between `Chat` and `ChatRetry`

| | |
|---|---|
| **Agent** | code-simplifier |
| **Confidence** | 90 |
| **Location** | `src/commands/chat/retry.ts:32-83`, `src/commands/chat/index.ts:63-112,227-237` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`Chat.run()` (`src/commands/chat/index.ts:63-112`) and `ChatRetry.run()` (`src/commands/chat/retry.ts:32-70`) are near-identical: same conditional spinner (`stream || flags.quiet ? () => {} : startSpinner('Typing…', 300)`), same try/finally, same `if (stream) / else if (!result.raw) / else if (flags.json) / else` printing chain — differing only in which `chat-helpers.ts` function is called and the "empty response" error string. On top of that, `printConversationHint` (`retry.ts:72-82`, `index.ts:227-237`) is a byte-for-byte duplicate private method in both classes, both new files in this PR. Both classes already extend `AgentCommand`, and `chat-helpers.ts` already has a precedent for a shared response helper (`handleResponse`, added in commit `0144a4f` to dedupe `sendChat`/`retryChat` — this PR just didn't carry that dedup up one layer to the command classes).

#### Before
```typescript
// src/commands/chat/retry.ts:32-83
    async run(): Promise<void> {
        const { flags } = await this.parse(ChatRetry)

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        // --json always forces a non-streaming call so the full envelope is
        // available to print in one shot; --no-stream does the same for
        // plain-text output. Otherwise stream tokens as they arrive.
        const stream = !flags.json && !flags['no-stream']

        const stop =
            stream || flags.quiet ? () => {} : startSpinner('Typing…', 300)
        let result: ChatResult
        try {
            result = await retryChat({
                client,
                agentId,
                conversationId: flags.conversation as string,
                messageId: flags['message-id'] as string,
                stream,
                onText: stream ? (text) => process.stdout.write(text) : () => {}
            })
        } finally {
            stop()
        }

        if (stream) {
            process.stdout.write('\n')
        } else if (!result.raw) {
            throw new Error('Retry response was empty')
        } else if (flags.json) {
            process.stdout.write(`${JSON.stringify(result.raw, null, 2)}\n`)
            return
        } else {
            process.stdout.write(`${extractText(result.raw)}\n`)
        }
        this.printConversationHint(flags, agentId, result.conversationId)
    }

    private printConversationHint(
        flags: { quiet?: boolean },
        agentId: string,
        conversationId?: string
    ): void {
        if (!conversationId) return
        this.note(
            flags,
            `Conversation: ${conversationId} — resume with: chatbase chat -a ${agentId} --conversation ${conversationId} --resume`
        )
    }
```

```typescript
// src/commands/chat/index.ts:227-237 (identical duplicate)
    private printConversationHint(
        flags: { quiet?: boolean },
        agentId: string,
        conversationId?: string
    ): void {
        if (!conversationId) return
        this.note(
            flags,
            `Conversation: ${conversationId} — resume with: chatbase chat -a ${agentId} --conversation ${conversationId} --resume`
        )
    }
```

#### After
```typescript
// src/base/agent-command.ts — add a shared method both Chat and ChatRetry inherit
export abstract class AgentCommand extends BaseCommand {
    // ...existing baseFlags, agentId()...

    protected printConversationHint(
        flags: { quiet?: boolean },
        agentId: string,
        conversationId?: string
    ): void {
        if (!conversationId) return
        this.note(
            flags,
            `Conversation: ${conversationId} — resume with: chatbase chat -a ${agentId} --conversation ${conversationId} --resume`
        )
    }
}
```

```typescript
// src/client/chat-helpers.ts — shared one-shot response handling
/** Shows a spinner for non-streaming calls, runs `call`, and writes the
 * result to stdout the same way for both `chat` and `chat retry`: streamed
 * tokens, the JSON envelope, or extracted plain text. */
export async function runChatTurn(opts: {
    stream: boolean
    quiet?: boolean
    json?: boolean
    call: (onText: (text: string) => void) => Promise<ChatResult>
}): Promise<ChatResult> {
    const stop =
        opts.stream || opts.quiet ? () => {} : startSpinner('Typing…', 300)
    let result: ChatResult
    try {
        result = await opts.call(
            opts.stream ? (text) => process.stdout.write(text) : () => {}
        )
    } finally {
        stop()
    }

    if (opts.stream) {
        process.stdout.write('\n')
    } else if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.raw, null, 2)}\n`)
    } else {
        process.stdout.write(`${extractText(result.raw)}\n`)
    }
    return result
}
```

```typescript
// src/commands/chat/retry.ts:32-58 — the empty-response guard moves into
// handleResponse (see #27), so runChatTurn no longer needs it here either
    async run(): Promise<void> {
        const { flags } = await this.parse(ChatRetry)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const stream = !flags.json && !flags['no-stream']

        const result = await runChatTurn({
            stream,
            quiet: flags.quiet,
            json: flags.json,
            call: (onText) =>
                retryChat({
                    client,
                    agentId,
                    conversationId: flags.conversation as string,
                    messageId: flags['message-id'] as string,
                    stream,
                    onText
                })
        })
        if (!flags.json) {
            this.printConversationHint(flags, agentId, result.conversationId)
        }
    }
    // printConversationHint removed — inherited from AgentCommand
```

```typescript
// src/commands/chat/index.ts:63-112 — same shape, sendChat instead of retryChat
    async run(): Promise<void> {
        const { flags } = await this.parse(Chat)
        if (!flags.message && process.stdin.isTTY) {
            await this.runInteractive(flags)
            return
        }
        const message = await this.resolveMessage(flags)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const stream = !flags.json && !flags['no-stream']

        const result = await runChatTurn({
            stream,
            quiet: flags.quiet,
            json: flags.json,
            call: (onText) =>
                sendChat({
                    client,
                    agentId,
                    message,
                    conversationId: flags.conversation,
                    stream,
                    onText
                })
        })
        if (!flags.json) {
            this.printConversationHint(flags, agentId, result.conversationId)
        }
    }
    // printConversationHint removed — inherited from AgentCommand
```

#### Trade-off note
This pairs with #27's fix to `ChatResult`/`handleResponse` (moving the `!result.raw` empty-response guard into `handleResponse` itself). If #27 isn't applied, `runChatTurn` needs to keep the `else if (!result.raw) throw new Error(...)` branch, and the two commands would need to pass a per-command empty-response message into it — still a net reduction in duplication versus the current state, just slightly less clean.

---

## Important Issues (75-89)

---

### #3 — Mid-stream `error` SSE events fall through `parseSseStream`'s if/else chain unhandled

| | |
|---|---|
| **Agent** | chaos |
| **Confidence** | 85 |
| **Location** | `src/client/stream.ts:8-11,60-78` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`StreamEvent` (`stream.ts:8-11`) only has `'text' | 'metadata' | 'done'` variants, and the parsing chain at `stream.ts:60-78` only matches `part.type === 'text-delta'` or `'message-metadata'/'finish'`. Any other `part.type` — including a mid-stream failure signal the server might emit — hits neither branch, so no `onEvent` call happens and the loop just continues to the next block. `chat-helpers.ts`'s `handleResponse` (the only consumer) accumulates whatever text arrived via `onText` and returns normally once the stream ends, with no way to know a failure signal was seen and dropped. The CLI would print a truncated response and exit 0.

#### Before
```typescript
// src/client/stream.ts:8-11
export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
    | { type: 'done' }
```
```typescript
// src/client/stream.ts:60-78
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

#### After
```typescript
// src/client/stream.ts:8-12
export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
    | { type: 'error'; errorText: string }
    | { type: 'done' }
```
```typescript
// src/client/stream.ts:60-84
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
                    } else if (part.type === 'error') {
                        onEvent({
                            type: 'error',
                            errorText:
                                typeof part.errorText === 'string'
                                    ? part.errorText
                                    : 'Stream reported an error'
                        })
                    }
```

The consumer side (making `handleResponse` in `chat-helpers.ts` throw on this new `'error'` event instead of returning a normal `ChatResult`) is the other half of this fix and is covered by issue #11 (assigned to the correctness agent) — see Cross-references.

---

### #6 — `tryOpenBrowser` spawns without an `'error'` listener; async ENOENT crashes the process mid-login

| | |
|---|---|
| **Agent** | chaos |
| **Confidence** | 84 |
| **Location** | `src/commands/auth/login.ts:11-29` |
| **Applicability** | easy |
| **Fixed** | [ ] |

#### Problem
`spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()` (both branches, lines 18-21 and 25) has no `.on('error', ...)` handler. The enclosing `try/catch` only catches a synchronous throw from `spawn()` itself; a missing binary (`xdg-open` on a minimal/headless Linux box, a container, an SSH session) fails asynchronously with ENOENT, which Node delivers as an `'error'` event on the returned `ChildProcess`. There is no listener for it (confirmed: no `uncaughtException`/`unhandledRejection` handler anywhere in `src/` or `bin/run.js`), so Node's default behavior — throw as an uncaught exception — crashes the whole `auth login --browser` process, typically right after "Waiting for approval..." is printed, mid-pairing.

#### Before
```typescript
// src/commands/auth/login.ts:11-29
function tryOpenBrowser(url: string): void {
    try {
        if (process.platform === 'win32') {
            // `start` is a cmd.exe built-in, not a standalone executable —
            // spawning it directly throws ENOENT. Run it through cmd.exe
            // instead; the empty '' arg keeps `start` from treating the URL
            // as the window title.
            spawn('cmd', ['/c', 'start', '', url], {
                detached: true,
                stdio: 'ignore'
            }).unref()
            return
        }
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
        spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
    } catch {
        // Browser open is best-effort — the URL is printed to stderr anyway.
    }
}
```

#### After
```typescript
// src/commands/auth/login.ts:11-31
function tryOpenBrowser(url: string): void {
    // Best-effort — the URL is printed to stderr regardless, so a failed
    // open (missing binary, no display, sandboxed shell) must never crash
    // the login flow. spawn() failures can arrive two ways: synchronously
    // (caught below) or asynchronously as an 'error' event on the returned
    // ChildProcess (an ENOENT after the process has already been handed
    // back) — an unhandled 'error' event throws and kills the process, so
    // it needs its own no-op listener.
    try {
        if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'start', '', url], {
                detached: true,
                stdio: 'ignore'
            })
                .on('error', () => {})
                .unref()
            return
        }
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
        spawn(cmd, [url], { detached: true, stdio: 'ignore' })
            .on('error', () => {})
            .unref()
    } catch {
        // Synchronous spawn() failure — same best-effort contract.
    }
}
```

---

### #8 & #16 — `--resume` history fetch failure is a completely silent empty catch

| | |
|---|---|
| **Agent** | error-handling / logging |
| **Confidence** | 82 |
| **Location** | `src/commands/chat/index.ts:129-148` |
| **Applicability** | easy |
| **Fixed** | [ ] |

#### Problem
The `catch { /* comment only */ }` at `chat/index.ts:145-147` has no bound error variable and produces zero output — not a note, not stderr, nothing. A bad/typo'd `--conversation` id and a genuine transient network failure both look exactly like "this is a brand-new conversation, there's no history yet." The `--resume` UX is explicitly best-effort (the surrounding comment says the chat must not be blocked by a failed fetch), and that non-blocking behavior is correct and should stay — the defect is that the failure is invisible even though the repo already has a convention for this exact situation: `auth logout`'s revoke best-effort catch (`logout.ts:39-46`) prints a yellow warning noting the failure while still proceeding. `--resume`'s catch doesn't follow that convention at all.

#### Before
```typescript
// src/commands/chat/index.ts:129-148
        if (flags.conversation && flags.resume) {
            try {
                const history = await fetchRecentHistory({
                    client,
                    agentId,
                    conversationId: flags.conversation
                })
                if (history.length > 0) {
                    const dim = this.palette(flags).dim
                    this.note(flags, dim(`— resuming ${flags.conversation} —`))
                    for (const line of history) {
                        const who = line.role === 'user' ? 'you' : 'agent'
                        this.note(flags, dim(`${who}: ${line.text}`))
                    }
                    this.note(flags, dim('—'))
                }
            } catch {
                // History is a nicety; the conversation still works without it.
            }
        }
```

#### After
```typescript
// src/commands/chat/index.ts:129-152
        if (flags.conversation && flags.resume) {
            try {
                const history = await fetchRecentHistory({
                    client,
                    agentId,
                    conversationId: flags.conversation
                })
                if (history.length > 0) {
                    const dim = this.palette(flags).dim
                    this.note(flags, dim(`— resuming ${flags.conversation} —`))
                    for (const line of history) {
                        const who = line.role === 'user' ? 'you' : 'agent'
                        this.note(flags, dim(`${who}: ${line.text}`))
                    }
                    this.note(flags, dim('—'))
                }
            } catch (err) {
                // Still best-effort — the conversation continues either
                // way — but a bad --conversation id and "no history yet"
                // must not look identical.
                const detail = err instanceof Error ? err.message : String(err)
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        `! Could not load history for ${flags.conversation} (${detail}) — continuing without it.`
                    )
                )
            }
        }
```

---

### #9 — Concurrent `sources sync` runs both create the same file as duplicate remote sources

| | |
|---|---|
| **Agent** | chaos |
| **Confidence** | 80 |
| **Location** | `src/sync/diff.ts:139-182`, `src/commands/sources/sync.ts` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`computeSyncPlan` (`diff.ts:139-182`) is a pure function over a single point-in-time `remote: SourceItem[]` snapshot passed in by `sources/sync.ts:118` (`await listAllSources(client, agentId)`). Two `sources sync` invocations against the same directory/agent that overlap in time (a CI job and a manual run, two CI shards, a cron overlap) each fetch that same "file doesn't exist yet" snapshot, each compute `create` for the same local file, and each successfully call `uploadFileSource` — there is no client-side lock and no server-side uniqueness constraint on `(agentId, name)` (confirmed against `spec/openapi.json`: the only 409s on the sources endpoints are `SOURCE_ALREADY_PENDING_DELETION`/`SOURCE_PENDING_DELETION`, nothing about duplicate names). Both uploads succeed, producing two remote sources with the same name; the next `sources sync`'s `remoteByName = new Map(remoteFiles.map(r => [r.name, r]))` (`diff.ts:149`) silently collapses the duplicate pair to whichever one iterates last, leaving the other an orphaned, permanently-untracked source that nothing will ever clean up.

#### Before
```typescript
// src/commands/sources/sync.ts:104-119 — no locking around the read-then-write
    async run(): Promise<void> {
        const { args, flags } = await this.parse(SourcesSync)
        const project = findProjectConfig()
        const dir = resolveSyncDir(args.dir, project)
        assertDirReadable(dir)
        const include = flags.include ?? project?.sync?.include
        const exclude = flags.exclude ?? project?.sync?.exclude

        const local = scanDir(dir, { include, exclude })

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const remote = await listAllSources(client, agentId)
        const plan = computeSyncPlan(local, remote)
```

#### After
```typescript
// src/commands/sources/sync.ts — advisory lock scoped to (dir, agentId),
// held for the lifetime of the sync so a second concurrent run fails fast
// instead of silently racing.
import { acquireSyncLock } from '../../sync/lock.js'
// ...
    async run(): Promise<void> {
        const { args, flags } = await this.parse(SourcesSync)
        const project = findProjectConfig()
        const dir = resolveSyncDir(args.dir, project)
        assertDirReadable(dir)
        const include = flags.include ?? project?.sync?.include
        const exclude = flags.exclude ?? project?.sync?.exclude

        const local = scanDir(dir, { include, exclude })

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const releaseLock = await acquireSyncLock(dir, agentId)
        try {
            const remote = await listAllSources(client, agentId)
            const plan = computeSyncPlan(local, remote)
            // ...rest of run() unchanged, moved inside the try...
        } finally {
            releaseLock()
        }
    }
```
```typescript
// src/sync/lock.ts — new file: exclusive-create lock file, stale-lock aware
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { UsageError } from '../errors/errors.js'

const STALE_MS = 5 * 60_000

function lockPath(dir: string, agentId: string): string {
    const key = crypto
        .createHash('sha1')
        .update(`${path.resolve(dir)}::${agentId}`)
        .digest('hex')
    return path.join(os.tmpdir(), `chatbase-sync-${key}.lock`)
}

/** Exclusive-create lock so two concurrent `sources sync` runs against the
 * same directory/agent don't both create the same file remotely. A lock
 * older than STALE_MS is assumed to be from a crashed run and reclaimed. */
export async function acquireSyncLock(
    dir: string,
    agentId: string
): Promise<() => void> {
    const file = lockPath(dir, agentId)
    try {
        fs.writeFileSync(file, String(process.pid), { flag: 'wx' })
    } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code !== 'EEXIST') throw err
        const age = Date.now() - fs.statSync(file).mtimeMs
        if (age < STALE_MS) {
            throw new UsageError(
                `Another \`sources sync\` appears to be running against this directory/agent (lock: ${file}). Wait for it to finish, or remove the lock file if it crashed.`
            )
        }
        fs.writeFileSync(file, String(process.pid))
    }
    return () => {
        try {
            fs.unlinkSync(file)
        } catch {
            /* already gone — fine */
        }
    }
}
```

#### Alternative approach
A client-side lock only protects against two invocations of *this* CLI; it doesn't stop a duplicate from a different tool hitting the same API. The more robust fix is a server-side idempotency guard (unique constraint or upsert-by-name on file sources), which is outside this repo's control — worth flagging to the API team. The lock file above is the pragmatic CLI-side mitigation available today.

---

### #12 — `catch {}` on the logout revoke call discards the error object, not just the message

| | |
|---|---|
| **Agent** | logging |
| **Confidence** | 80 |
| **Location** | `src/commands/auth/logout.ts:39-46` |
| **Applicability** | easy |
| **Fixed** | [ ] |

#### Problem
`catch {` (no bound parameter) at `logout.ts:39` means the thrown error — whether a network failure or an `ApiError` with `.code`/`.requestId`/`.status` from `throwIfError` — is unreachable inside the block. The user does see a message (`! Could not reach the API to revoke the key...`), so this isn't a fully silent failure; but the message is a hardcoded generic string with zero information from the actual failure, and nothing (not the note, not a log file, unlike `BaseCommand#catch`'s "unexpected error" path which does write a log file) preserves the error's detail anywhere. If a user reports "logout said it couldn't revoke, why?", there is no diagnosable trail.

#### Before
```typescript
// src/commands/auth/logout.ts:25-47
        if (config.apiKeySource === 'pairing') {
            try {
                const client = createApiClient({ apiKey: config.apiKey })
                const { response } = await client.DELETE('/me/credential')
                if (response.ok) {
                    this.note(flags, 'CLI session revoked server-side.')
                } else {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            `! Could not revoke the key server-side (${response.status}) — revoke it manually at chatbase.co if needed.`
                        )
                    )
                }
            } catch {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Could not reach the API to revoke the key — revoke it manually at chatbase.co if needed.'
                    )
                )
            }
        }
```

#### After
```typescript
// src/commands/auth/logout.ts:25-49
        if (config.apiKeySource === 'pairing') {
            try {
                const client = createApiClient({ apiKey: config.apiKey })
                const { response } = await client.DELETE('/me/credential')
                if (response.ok) {
                    this.note(flags, 'CLI session revoked server-side.')
                } else {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            `! Could not revoke the key server-side (${response.status}) — revoke it manually at chatbase.co if needed.`
                        )
                    )
                }
            } catch (err) {
                const detail = err instanceof Error ? err.message : String(err)
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        `! Could not reach the API to revoke the key (${detail}) — revoke it manually at chatbase.co if needed.`
                    )
                )
            }
        }
```

---

### #13 — `errorMessage()` drops `ApiError.code`/`.requestId`, the exact fields the codebase already knows how to format

| | |
|---|---|
| **Agent** | logging |
| **Confidence** | 79 |
| **Location** | `src/sync/execute.ts:46-48` |
| **Applicability** | easy |
| **Fixed** | [ ] |

#### Problem
`errorMessage(err)` reduces every failure to `err.message`. Both failure sources in this file — `uploadFileSource` (`client/files.ts`, throws via `parseErrorResponse`) and the delete call's `throwIfError` (`client/client.ts:157`) — throw `ApiError` instances (`errors/errors.ts:3-25`) carrying `code`, `status`, `requestId`, and `details` beyond `.message`. The codebase already has `formatApiError()` (`errors/errors.ts:97-112`) that renders all of this richly (including `request id: ...`) for the top-level command-catch path — `sync/execute.ts` just doesn't use any of it, so the printed `✗ name: message` line in `sources sync` gives no request ID to correlate against server-side logs, unlike every other API failure path in this CLI.

#### Before
```typescript
// src/sync/execute.ts:46-48
function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}
```

#### After
```typescript
// src/sync/execute.ts:1-5,46-53
import type { Client } from 'openapi-fetch'
import { throwIfError } from '../client/client.js'
import { uploadFileSource } from '../client/files.js'
import { ApiError } from '../errors/errors.js'
import type { paths } from '../generated/api.js'
// ...
function errorMessage(err: unknown): string {
    if (err instanceof ApiError) {
        const parts = [`${err.message} (${err.code})`]
        if (err.requestId) parts.push(`request id: ${err.requestId}`)
        return parts.join(' — ')
    }
    return err instanceof Error ? err.message : String(err)
}
```

---

### #14 — Retry-loop backoff sleep isn't wired to the per-call abort signal; Ctrl-C waits out up to 60s

| | |
|---|---|
| **Agent** | error-handling |
| **Confidence** | 78 |
| **Location** | `src/client/client.ts:58,105-138` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
This PR adds per-call abort signals so "Ctrl-C cancels one chat response" (see the doc comment at `chat/index.ts:114-121` and the REPL's own SIGINT interception in `repl/chat-repl.ts:70-76`, both new in this diff) instead of poisoning the whole session. The signal is correctly threaded into `toPlainRequestInit` and into the fetch call's `AbortSignal.any([...])` at `client.ts:119-123` — but the inter-attempt backoff `sleep()` at `client.ts:130-136` is a bare `setTimeout` with no signal at all. If a 429 response triggers a backoff wait (up to 60s, per `computeRetryDelayMs`'s cap keyed off `x-ratelimit-reset`) and the user presses Ctrl-C during that wait, the REPL's `currentController.abort()` fires immediately, but the sleep doesn't observe it — the loop only notices the abort on the *next* `undiciFetch` call, after the full wait elapses. Worse, inside the REPL, Ctrl-C during a turn is captured by `readline`'s own `'SIGINT'` handler (`chat-repl.ts:70-76`) rather than the process-wide `installSigintHandler`'s two-strikes-to-force-exit logic, so there's no way to force-quit during that wait either — the user is stuck for the full backoff.

#### Before
```typescript
// src/client/client.ts:58
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
```
```typescript
// src/client/client.ts:105-139
export function makeFetch(opts: ApiClientOptions) {
    const timeoutMs = opts.timeoutMs ?? resolveTimeoutMs()
    return async (
        input: string | URL | Request,
        init?: UndiciRequestInit
    ): Promise<UndiciResponse> => {
        const { url, method, requestInit, signal } = await toPlainRequestInit(
            input,
            init
        )
        for (let attempt = 1; ; attempt++) {
            const response = await undiciFetch(url, {
                ...requestInit,
                dispatcher: dispatcher(),
                signal: AbortSignal.any([
                    AbortSignal.timeout(timeoutMs),
                    getSigintSignal(),
                    ...(signal ? [signal] : [])
                ]) as AbortSignal
            })
            if (response.ok || !shouldRetry(response.status, method, attempt))
                return response
            // Draining before the retry avoids leaking the unread response
            // body's underlying connection while we sleep and loop.
            await response.body?.cancel()
            await sleep(
                computeRetryDelayMs(
                    attempt,
                    response.headers.get('x-ratelimit-reset'),
                    Date.now()
                )
            )
        }
    }
}
```

#### After
```typescript
// src/client/client.ts:58-68
const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason)
        const timer = setTimeout(resolve, ms)
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer)
                reject(signal.reason)
            },
            { once: true }
        )
    })
```
```typescript
// src/client/client.ts:115-149
export function makeFetch(opts: ApiClientOptions) {
    const timeoutMs = opts.timeoutMs ?? resolveTimeoutMs()
    return async (
        input: string | URL | Request,
        init?: UndiciRequestInit
    ): Promise<UndiciResponse> => {
        const { url, method, requestInit, signal } = await toPlainRequestInit(
            input,
            init
        )
        for (let attempt = 1; ; attempt++) {
            const attemptSignal = AbortSignal.any([
                AbortSignal.timeout(timeoutMs),
                getSigintSignal(),
                ...(signal ? [signal] : [])
            ]) as AbortSignal
            const response = await undiciFetch(url, {
                ...requestInit,
                dispatcher: dispatcher(),
                signal: attemptSignal
            })
            if (response.ok || !shouldRetry(response.status, method, attempt))
                return response
            // Draining before the retry avoids leaking the unread response
            // body's underlying connection while we sleep and loop.
            await response.body?.cancel()
            // Same signal as the fetch above, so Ctrl-C (or the REPL's
            // per-call cancel) interrupts the backoff wait too, instead of
            // only taking effect on the next attempt.
            await sleep(
                computeRetryDelayMs(
                    attempt,
                    response.headers.get('x-ratelimit-reset'),
                    Date.now()
                ),
                attemptSignal
            )
        }
    }
}
```

---

### #15 — `--resume` is only honored in the interactive-REPL branch; `-m`/piped stdin silently ignores it

| | |
|---|---|
| **Agent** | git-context |
| **Confidence** | 78 |
| **Location** | `src/commands/chat/index.ts:63-148` |
| **Applicability** | needs-focus (needs-product-confirmation for the full fix) |
| **Fixed** | [ ] |

#### Problem
`flags.resume` (declared at `index.ts:42-46` with `dependsOn: ['conversation']`, applying to the command generically) is read exactly once in the whole file, at `index.ts:129`, inside `runInteractive()` — the branch only reached when there's no `-m` and stdin is a TTY. `run()`'s one-shot path (`index.ts:63-112`, taken whenever `-m` is passed or stdin is piped) never references `flags.resume` at all. `chatbase chat -a agt_1 -m "continue" --conversation c_1 --resume` parses and runs successfully with `--resume` having zero effect and no warning that it was ignored — unlike `sources sync`'s `confirmSync`, which explicitly throws a `UsageError` naming the exact reason when a flag combination can't be honored non-interactively. Whether `--resume` *should* also replay history before a one-shot `-m` send (printing the banner to stderr before the message goes out) is a product call; that it should never be silently swallowed is not.

#### Before
```typescript
// src/commands/chat/index.ts:63-74 — run() never inspects flags.resume
    async run(): Promise<void> {
        const { flags } = await this.parse(Chat)

        if (!flags.message && process.stdin.isTTY) {
            await this.runInteractive(flags)
            return
        }

        // Resolve the message first: it's local (no network), so a failure
        // here doesn't first need working credentials or an agent lookup
        // round trip to fail fast.
        const message = await this.resolveMessage(flags)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
```

#### After (minimal — surface the ignored flag; safe regardless of the product decision below)
```typescript
// src/commands/chat/index.ts:63-76
    async run(): Promise<void> {
        const { flags } = await this.parse(Chat)

        if (!flags.message && process.stdin.isTTY) {
            await this.runInteractive(flags)
            return
        }

        if (flags.resume) {
            this.note(
                flags,
                this.palette(flags).yellow(
                    '! --resume only replays history in the interactive REPL (no -m, piped-stdin TTY) — ignored here.'
                )
            )
        }

        const message = await this.resolveMessage(flags)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
```

#### Alternative approach (needs product confirmation)
If `--resume` is meant to work for one-shot `-m`/piped sends too, hoist the try/catch block at `index.ts:130-152` out of `runInteractive` into a shared private method (`printResumeBanner(flags, client, agentId)`) and call it from both `run()` and `runInteractive()` before sending. This is a real feature addition (an extra network round trip before every resumed one-shot send), not just a warning — confirm the UX is wanted before building it.

---

### #18 — `startPairing`/`pollExchange` cast responses to hand-written literals instead of the generated schema types

| | |
|---|---|
| **Agent** | type-design |
| **Confidence** | 82 |
| **Location** | `src/client/pairing.ts:18-44,61-75` |
| **Applicability** | easy |
| **Fixed** | [ ] |

#### Problem
`startPairing` casts `data as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }` (`pairing.ts:30-36`) and `pollExchange` casts `data as { api_key: string; workspace: { id: string; name: string } }` (`pairing.ts:67-70`), both hand-written instead of the generated `components['schemas']['CliPairingCreateResponse']`/`CliPairingExchangeResponse'` (`generated/api.d.ts:7420`,`7456`) that already exist in this same spec refresh (commit `c0dc931`). This isn't hypothetical: this exact file's history shows the cost. `CliPairingCreateResponse` still documents a `verification_uri_complete` field server-side, and this file's hand-written type was manually edited twice as that field's real usage changed (commit `de91a78` removed it from the cast and from `login.ts` after the server stopped needing it; commit `7087456` changed the URL-building strategy again) — both times with zero compiler assistance, because a hand-written cast on `unknown` never gets checked against the actual contract. `chat-helpers.ts`'s `ChatResponseEnvelope = { data: components['schemas']['ChatResponse'] }` (added in this same PR) shows the correct pattern already exists elsewhere in this diff.

#### Before
```typescript
// src/client/pairing.ts:1-44
import os from 'node:os'
import { createApiClient, throwIfError } from './client.js'

export type PairingResult = {
    apiKey: string
    workspace: { id: string; name: string }
}

export async function startPairing(opts?: { baseUrl?: string }): Promise<{
    deviceCode: string
    userCode: string
    verificationUri: string
    expiresIn: number
    interval: number
}> {
    const client = createApiClient({ baseUrl: opts?.baseUrl })
    const { data, error, response } = await client.POST('/cli/pairing', {
        body: { device_name: os.hostname() }
    })
    throwIfError(response, error)
    const d = data as {
        device_code: string
        user_code: string
        verification_uri: string
        expires_in: number
        interval: number
    }
    return {
        deviceCode: d.device_code,
        userCode: d.user_code,
        verificationUri: d.verification_uri,
        expiresIn: d.expires_in,
        interval: d.interval
    }
}
```
```typescript
// src/client/pairing.ts:66-75
        if (response.ok) {
            const result = data as {
                api_key: string
                workspace: { id: string; name: string }
            }
            return {
                apiKey: result.api_key,
                workspace: result.workspace
            }
        }
```

#### After
```typescript
// src/client/pairing.ts:1-38
import os from 'node:os'
import type { components } from '../generated/api.js'
import { createApiClient, throwIfError } from './client.js'

export type PairingResult = {
    apiKey: string
    workspace: { id: string; name: string }
}

export async function startPairing(opts?: { baseUrl?: string }): Promise<{
    deviceCode: string
    userCode: string
    verificationUri: string
    expiresIn: number
    interval: number
}> {
    const client = createApiClient({ baseUrl: opts?.baseUrl })
    const { data, error, response } = await client.POST('/cli/pairing', {
        body: { device_name: os.hostname() }
    })
    throwIfError(response, error)
    const d = data as components['schemas']['CliPairingCreateResponse']
    return {
        deviceCode: d.device_code,
        userCode: d.user_code,
        verificationUri: d.verification_uri,
        expiresIn: d.expires_in,
        interval: d.interval
    }
}
```
```typescript
// src/client/pairing.ts:~62-71
        if (response.ok) {
            const result =
                data as components['schemas']['CliPairingExchangeResponse']
            return {
                apiKey: result.api_key,
                workspace: result.workspace
            }
        }
```

---

### #19 — Unparseable `expiresAt` → "Expires in NaN days"

| | |
|---|---|
| **Agent** | chaos |
| **Confidence** | 76 |
| **Location** | `src/commands/auth/status.ts:57-82` |
| **Applicability** | easy |
| **Fixed** | [ ] |

#### Problem
`new Date(cred.expiresAt).getTime()` returns `NaN` for any unparseable string; `remaining = Math.ceil(NaN / ...)` is `NaN`, and `NaN <= 0` and `NaN <= 7` are both `false` in JS, so execution falls through to the final `else` and prints `Expires in NaN days` — a real, user-visible artifact for any malformed `credential.expiresAt` in the `/me` response, with no guard anywhere in this new block.

#### Before
```typescript
// src/commands/auth/status.ts:57-82
            if (cred?.expiresAt) {
                const remaining = Math.ceil(
                    (new Date(cred.expiresAt).getTime() - Date.now()) /
                        (1000 * 60 * 60 * 24)
                )
                if (remaining <= 0) {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            '! Already expired — re-pair with `chatbase auth login --browser`'
                        )
                    )
                } else if (remaining <= 7) {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            `! Expires in ${remaining} day${remaining !== 1 ? 's' : ''} — re-pair with \`chatbase auth login --browser\``
                        )
                    )
                } else {
                    this.note(
                        flags,
                        `Expires in ${remaining} day${remaining !== 1 ? 's' : ''}`
                    )
                }
            }
```

#### After
```typescript
// src/commands/auth/status.ts:57-86
            if (cred?.expiresAt) {
                const remaining = Math.ceil(
                    (new Date(cred.expiresAt).getTime() - Date.now()) /
                        (1000 * 60 * 60 * 24)
                )
                if (Number.isNaN(remaining)) {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            `! Could not parse credential expiry (${cred.expiresAt})`
                        )
                    )
                } else if (remaining <= 0) {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            '! Already expired — re-pair with `chatbase auth login --browser`'
                        )
                    )
                } else if (remaining <= 7) {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            `! Expires in ${remaining} day${remaining !== 1 ? 's' : ''} — re-pair with \`chatbase auth login --browser\``
                        )
                    )
                } else {
                    this.note(
                        flags,
                        `Expires in ${remaining} day${remaining !== 1 ? 's' : ''}`
                    )
                }
            }
```

---

### #20 — Deduped `readStdinToEnd()` now `.trim()`s `@-` stdin, silently diverging from `@file`'s verbatim fidelity

| | |
|---|---|
| **Agent** | code-quality |
| **Confidence** | 78 |
| **Location** | `src/base/body-input.ts:5-13`, `src/commands/chat/index.ts:53-61`, `src/commands/auth/login.ts:55-63` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
Confirmed via `git diff origin/feat/full-coverage...HEAD -- src/base/body-input.ts`: before this PR's dedup refactor (commit `8a12c67`), the `@-` branch's inline stdin reader ended with `return raw` (verbatim). The new shared `readStdinToEnd()` ends with `return raw.trim()` (`body-input.ts:12`), and `resolveInput`'s `@-` branch now just calls it (`body-input.ts:23`). `@file`'s branch (`fs.readFileSync(filePath, 'utf8')`, `body-input.ts:32`) is untouched and still returns file content verbatim. So `--content @-` (piped text-source content, via `readTextInput`) now silently strips leading/trailing whitespace that `--content @path/to/file` with identical bytes would preserve — a real fidelity regression introduced as a side effect of merging with the two other call sites (`login.ts`'s `--with-token` and `chat/index.ts`'s piped-message read) that *do* want trimming.

#### Before
```typescript
// src/base/body-input.ts:5-13
export async function readStdinToEnd(): Promise<string> {
    let raw = ''
    // setEncoding before iterating makes Node decode UTF-8 across chunk
    // boundaries; without it each Buffer chunk is coerced to a string
    // independently, corrupting multi-byte characters split mid-chunk.
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) raw += chunk
    return raw.trim()
}
```

#### After
```typescript
// src/base/body-input.ts:5-14
/** Read all of stdin as a UTF-8 string, verbatim — matches @file's fidelity
 * (fs.readFileSync returns exact bytes too). Callers that want trimmed
 * input (a pasted key, a chat message) trim it themselves. */
export async function readStdinToEnd(): Promise<string> {
    let raw = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) raw += chunk
    return raw
}
```
```typescript
// src/commands/chat/index.ts:53-61
    private async resolveMessage(flags: { message?: string }): Promise<string> {
        if (flags.message) return flags.message
        const piped = (await readStdinToEnd()).trim()
        if (piped) return piped
        throw new UsageError('No message received on stdin.')
    }
```
```typescript
// src/commands/auth/login.ts:55-63
        if (flags['with-token']) {
            if (process.stdin.isTTY)
                throw new UsageError(
                    '--with-token reads the key from stdin. Pipe it: chatbase auth login --with-token < key.txt'
                )
            const key = (await readStdinToEnd()).trim()
            if (!key) throw new UsageError('No token received on stdin.')
            return this.verifyAndStore(flags, key)
        }
```

---

### #21 — The `flags.quiet ? () => {} : startSpinner(...)` ternary is copy-pasted 5 times

| | |
|---|---|
| **Agent** | code-simplifier |
| **Confidence** | 76 |
| **Location** | `src/commands/chat/index.ts:86,153`, `src/commands/chat/retry.ts:44`, `src/commands/sources/create.ts:110-112`, `src/commands/sources/update.ts:59-61` |
| **Applicability** | easy |
| **Fixed** | [ ] |

#### Problem
Confirmed 5 occurrences of the same `<condition> ? () => {} : startSpinner(text[, delayMs])` shape (some formatted on one line, some wrapped across 3 by Biome once the line got long). Every one exists purely to skip the spinner under `--quiet` (chat's two also skip it while streaming, since the streamed tokens are their own feedback).

#### Before
```typescript
// src/commands/chat/retry.ts:44
        const stop =
            stream || flags.quiet ? () => {} : startSpinner('Typing…', 300)
```
```typescript
// src/commands/chat/index.ts:86
        const stop =
            stream || flags.quiet ? () => {} : startSpinner('Typing…', 300)
```
```typescript
// src/commands/chat/index.ts:153
            const stop = flags.quiet ? () => {} : startSpinner('Typing…', 300)
```
```typescript
// src/commands/sources/create.ts:110-112
            const stop = flags.quiet
                ? () => {}
                : startSpinner(`Uploading ${flags.file}…`)
```
```typescript
// src/commands/sources/update.ts:59-61
            const stop = flags.quiet
                ? () => {}
                : startSpinner(`Uploading ${flags.file}…`)
```

#### After
```typescript
// src/output/spinner.ts — add alongside startSpinner
/** Convenience for the common `<suppress> ? noop : startSpinner(...)` guard. */
export function maybeSpinner(
    suppress: boolean | undefined,
    text: string,
    delayMs = 0
): () => void {
    return suppress ? () => {} : startSpinner(text, delayMs)
}
```
```typescript
// src/commands/chat/retry.ts:44 and src/commands/chat/index.ts:86
        const stop = maybeSpinner(stream || flags.quiet, 'Typing…', 300)
```
```typescript
// src/commands/chat/index.ts:153
            const stop = maybeSpinner(flags.quiet, 'Typing…', 300)
```
```typescript
// src/commands/sources/create.ts:110 and src/commands/sources/update.ts:59
            const stop = maybeSpinner(flags.quiet, `Uploading ${flags.file}…`)
```
(each call site's `import { startSpinner }` becomes `import { maybeSpinner }`)

---

### #22 — `AuthStatus.run` is a single ~110-line method with up to 4 levels of nesting

| | |
|---|---|
| **Agent** | code-simplifier |
| **Confidence** | 76 |
| **Location** | `src/commands/auth/status.ts:17-127` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`run()` spans the entire class body (lines 17-127) and mixes four concerns inline: the base-URL override warning, credential resolution, the `/me` network call, and three sibling rendering branches (success / 401-403 / other-error) — the success branch alone nests `if (response.ok) → if (cred?.expiresAt) → if (remaining <= 0) / else if / else` three levels deep. Nothing here is algorithmically complex; it's a rendering fan-out that reads more easily as named methods, matching the `renderX` style already implicit in the branch structure.

#### Before
See full method at `src/commands/auth/status.ts:17-127` (reproduced in the file read above — omitted here for length; unchanged from the PR's current state).

#### After
```typescript
// src/commands/auth/status.ts
import { BaseCommand, type BaseFlags } from '../../base/base-command.js'
import {
    createApiClient,
    DEFAULT_BASE_URL,
    resolveBaseUrl
} from '../../client/client.js'
import { resolveApiKey } from '../../config/resolve.js'

type MeBody = {
    workspace?: { id?: string; name?: string }
    plan?: string
    credential?: {
        source?: string | null
        expiresAt?: string | null
        permissions?: string[] | null
    }
}

export default class AuthStatus extends BaseCommand {
    static override description =
        'Show the active credential and where it comes from'
    static override examples = ['<%= config.bin %> auth status']
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(AuthStatus)
        this.warnIfBaseUrlOverridden(flags)

        const resolved = resolveApiKey()
        if (!resolved) {
            this.note(flags, 'Not authenticated. Run `chatbase auth login`.')
            return
        }
        const tail =
            resolved.value.length > 8 ? `…${resolved.value.slice(-4)}` : '…****'
        this.note(flags, `Credential: ${tail} (from ${resolved.source})`)

        const client = createApiClient({ apiKey: resolved.value })
        const { data, error, response } = await client.GET('/me')
        if (response.ok) {
            this.renderMe(flags, data as MeBody)
        } else if (response.status === 401 || response.status === 403) {
            this.renderAuthError(
                flags,
                error as { error?: { code?: string } } | null
            )
        } else {
            this.note(
                flags,
                this.palette(flags).yellow(
                    `! Could not verify key (server returned ${response.status})`
                )
            )
        }
    }

    private warnIfBaseUrlOverridden(flags: BaseFlags): void {
        const baseUrl = resolveBaseUrl()
        if (baseUrl === DEFAULT_BASE_URL) return
        this.note(
            flags,
            this.palette(flags).yellow(
                `! API base overridden: ${baseUrl} (CHATBASE_API_URL)`
            )
        )
    }

    private renderMe(flags: BaseFlags, body: MeBody): void {
        this.note(
            flags,
            `Workspace: ${body.workspace?.name ?? 'unknown'} (plan: ${body.plan ?? 'unknown'})`
        )
        const cred = body.credential
        if (cred?.source === 'cli') {
            this.note(flags, 'Key type: CLI-paired device')
        }
        if (cred?.expiresAt) {
            this.renderExpiry(flags, cred.expiresAt)
        }
        if (cred?.permissions) {
            this.note(flags, `Scopes: ${cred.permissions.join(', ') || 'none'}`)
        } else if (cred?.permissions === null) {
            this.note(flags, 'Scopes: full access')
        }
    }

    private renderExpiry(flags: BaseFlags, expiresAt: string): void {
        const remaining = Math.ceil(
            (new Date(expiresAt).getTime() - Date.now()) /
                (1000 * 60 * 60 * 24)
        )
        if (Number.isNaN(remaining)) {
            this.note(
                flags,
                this.palette(flags).yellow(
                    `! Could not parse credential expiry (${expiresAt})`
                )
            )
        } else if (remaining <= 0) {
            this.note(
                flags,
                this.palette(flags).yellow(
                    '! Already expired — re-pair with `chatbase auth login --browser`'
                )
            )
        } else if (remaining <= 7) {
            this.note(
                flags,
                this.palette(flags).yellow(
                    `! Expires in ${remaining} day${remaining !== 1 ? 's' : ''} — re-pair with \`chatbase auth login --browser\``
                )
            )
        } else {
            this.note(
                flags,
                `Expires in ${remaining} day${remaining !== 1 ? 's' : ''}`
            )
        }
    }

    private renderAuthError(
        flags: BaseFlags,
        errBody: { error?: { code?: string } } | null
    ): void {
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
    }
}
```
This refactor also incidentally applies the #19 NaN guard (folded into `renderExpiry`); #19's standalone patch is still listed separately for anyone applying only that fix.

---

### #23 — `assertDirReadable` reports every `fs.statSync` error as "Directory not found"

| | |
|---|---|
| **Agent** | error-handling |
| **Confidence** | 76 |
| **Location** | `src/commands/sources/sync.ts:27-37` |
| **Applicability** | easy |
| **Fixed** | [ ] |

#### Problem
The bare `catch {` at `sync.ts:31` swallows every `fs.statSync` error code uniformly — `ENOENT` (genuinely not found), but also `EACCES` (directory exists, but a parent lacks execute/search permission), `ENOTDIR` (a path component is a file), etc. — and reports all of them as `Directory not found: ${dir}`, which is actively misleading when the directory exists and the real problem is a permissions issue the user needs to fix differently.

#### Before
```typescript
// src/commands/sources/sync.ts:27-37
function assertDirReadable(dir: string): void {
    let stat: fs.Stats
    try {
        stat = fs.statSync(dir)
    } catch {
        throw new UsageError(`Directory not found: ${dir}`)
    }
    if (!stat.isDirectory()) {
        throw new UsageError(`Not a directory: ${dir}`)
    }
}
```

#### After
```typescript
// src/commands/sources/sync.ts:27-41
function assertDirReadable(dir: string): void {
    let stat: fs.Stats
    try {
        stat = fs.statSync(dir)
    } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'ENOENT') {
            throw new UsageError(`Directory not found: ${dir}`)
        }
        throw new UsageError(
            `Cannot read directory: ${dir} (${code ?? (err as Error)?.message})`
        )
    }
    if (!stat.isDirectory()) {
        throw new UsageError(`Not a directory: ${dir}`)
    }
}
```

---

### #24 — `pollExchange` has no try/catch around the exchange call; a transient network blip aborts the whole login

| | |
|---|---|
| **Agent** | error-handling |
| **Confidence** | 76 |
| **Location** | `src/client/pairing.ts:46-99` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`pollExchange`'s `for (;;)` loop directly `await`s `client.POST('/cli/pairing/exchange', ...)` (`pairing.ts:61-64`) with no try/catch. `makeFetch`'s own retry logic (`client.ts:105-138`) does not retry POST requests on 5xx (only GET), and any network-level failure (DNS, connection reset, or the per-attempt `AbortSignal.timeout` firing) makes the underlying `undiciFetch` — and so `client.POST` — reject rather than resolve with a response. That rejection propagates straight out of `pollExchange`, ending the entire (potentially multi-minute) `auth login --browser` wait with an "unexpected error" + log-file + GitHub-issue prompt, even though the loop already has a `deadline` and already tolerates the equivalent `PAIRING_PENDING` server response indefinitely until that deadline.

#### Before
```typescript
// src/client/pairing.ts:46-99
export async function pollExchange(
    deviceCode: string,
    opts: {
        intervalMs: number
        timeoutMs: number
        baseUrl?: string
        onPoll?: () => void
    }
): Promise<PairingResult> {
    const deadline = Date.now() + opts.timeoutMs
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const client = createApiClient({ baseUrl: opts.baseUrl })

    for (;;) {
        opts.onPoll?.()
        const { data, error, response } = await client.POST(
            '/cli/pairing/exchange',
            { body: { device_code: deviceCode } }
        )

        if (response.ok) {
            const result = data as {
                api_key: string
                workspace: { id: string; name: string }
            }
            return {
                apiKey: result.api_key,
                workspace: result.workspace
            }
        }

        const errorBody = error as {
            error?: { code?: string }
        }
        const code = errorBody?.error?.code

        if (code === 'PAIRING_PENDING' || code === 'PAIRING_SLOW_DOWN') {
            if (Date.now() >= deadline) {
                const { UsageError } = await import('../errors/errors.js')
                throw new UsageError(
                    'Pairing request expired. Run `chatbase auth login` to try again.'
                )
            }
            const delay =
                code === 'PAIRING_SLOW_DOWN'
                    ? opts.intervalMs * 2
                    : opts.intervalMs
            await sleep(delay)
            continue
        }

        throwIfError(response, error)
    }
}
```

#### After
```typescript
// src/client/pairing.ts:10-11 — new import
import { wasInterrupted } from './signals.js'
```
```typescript
// src/client/pairing.ts:46-110
export async function pollExchange(
    deviceCode: string,
    opts: {
        intervalMs: number
        timeoutMs: number
        baseUrl?: string
        onPoll?: () => void
    }
): Promise<PairingResult> {
    const deadline = Date.now() + opts.timeoutMs
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const client = createApiClient({ baseUrl: opts.baseUrl })

    for (;;) {
        opts.onPoll?.()

        let data: unknown
        let error: unknown
        let response: Response
        try {
            ;({ data, error, response } = await client.POST(
                '/cli/pairing/exchange',
                { body: { device_code: deviceCode } }
            ))
        } catch (err) {
            // A genuine Ctrl-C must still abort immediately — only
            // transient network/timeout failures get retried here.
            const name = (err as { name?: string } | null)?.name
            if (name === 'AbortError' && wasInterrupted()) throw err
            if (Date.now() >= deadline) {
                const { UsageError } = await import('../errors/errors.js')
                throw new UsageError(
                    'Pairing request expired. Run `chatbase auth login` to try again.'
                )
            }
            await sleep(opts.intervalMs)
            continue
        }

        if (response.ok) {
            const result = data as {
                api_key: string
                workspace: { id: string; name: string }
            }
            return {
                apiKey: result.api_key,
                workspace: result.workspace
            }
        }

        const errorBody = error as {
            error?: { code?: string }
        }
        const code = errorBody?.error?.code

        if (code === 'PAIRING_PENDING' || code === 'PAIRING_SLOW_DOWN') {
            if (Date.now() >= deadline) {
                const { UsageError } = await import('../errors/errors.js')
                throw new UsageError(
                    'Pairing request expired. Run `chatbase auth login` to try again.'
                )
            }
            const delay =
                code === 'PAIRING_SLOW_DOWN'
                    ? opts.intervalMs * 2
                    : opts.intervalMs
            await sleep(delay)
            continue
        }

        throwIfError(response, error)
    }
}
```

---

### #25 — Malformed SSE JSON is dropped via `catch { continue }` with no signal to the caller

| | |
|---|---|
| **Agent** | logging |
| **Confidence** | 76 |
| **Location** | `src/client/stream.ts:54-59` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`JSON.parse(payload)` failures at `stream.ts:56-59` are caught and skipped with `continue`, no bound error, no log. Because blocks are only parsed once a full `\n\n`-delimited chunk has been buffered (`stream.ts:41-46`), this isn't reachable from ordinary chunk-boundary splitting — it requires genuinely corrupted/non-JSON data in a `data:` line, a real (if rare) production scenario (proxy corruption, a server-side encoding bug) that would otherwise look, from the CLI's output, identical to a normal complete response. There's no `--verbose` (the flag is declared in `BaseCommand.baseFlags` but never read anywhere in `src/`) or log-file fallback that would surface this either.

#### Before
```typescript
// src/client/stream.ts:8-11
export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
    | { type: 'done' }
```
```typescript
// src/client/stream.ts:54-59
                    let part: Record<string, unknown>
                    try {
                        part = JSON.parse(payload) as Record<string, unknown>
                    } catch {
                        continue
                    }
```

#### After
```typescript
// src/client/stream.ts:8-12 — new variant, kept alongside #3's 'error' variant
export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
    | { type: 'parse-error'; raw: string }
    | { type: 'done' }
```
```typescript
// src/client/stream.ts:54-61
                    let part: Record<string, unknown>
                    try {
                        part = JSON.parse(payload) as Record<string, unknown>
                    } catch {
                        onEvent({ type: 'parse-error', raw: payload })
                        continue
                    }
```
```typescript
// src/client/chat-helpers.ts — handleResponse's onEvent callback: surface it
// without breaking stream.ts's side-effect-free design (it stays a pure
// function; the caller decides what to do with the signal)
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(event.text)
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
        }
        if (event.type === 'parse-error') {
            process.stderr.write(
                '\n[warning] received a malformed chunk mid-stream — response may be incomplete\n'
            )
        }
    })
```

---

### #27 — `ChatResult.raw`/`conversationId` are independently optional, forcing a duplicated runtime guard

| | |
|---|---|
| **Agent** | type-design |
| **Confidence** | 76 |
| **Location** | `src/client/chat-helpers.ts:22-58` |
| **Applicability** | needs-focus |
| **Fixed** | [ ] |

#### Problem
`ChatResult = { conversationId?: string; raw?: ChatResponseEnvelope }` lets both fields vary independently in the type system, even though `handleResponse` (`chat-helpers.ts:30-58`) only ever produces two real shapes: `{ raw, conversationId }` when `stream === false` (raw always populated from the non-streaming branch), and `{ conversationId }` (no `raw`) when `stream === true`. Because the type doesn't encode that link, `chat/index.ts:103` and `chat/retry.ts:61` each independently write `else if (!result.raw) throw new Error('... response was empty')` — the exact same guard, worded slightly differently, that a discriminated union would let TypeScript rule out at the call site instead of re-checking at runtime in two places.

#### Before
```typescript
// src/client/chat-helpers.ts:22-58
/** raw is the typed non-streaming envelope (from the generated OpenAPI
 * types); present only when the call was made with stream: false. */
export type ChatResult = {
    conversationId?: string
    raw?: ChatResponseEnvelope
}

/** Shared response handling for both sendChat and retryChat. */
async function handleResponse(
    data: unknown,
    error: unknown,
    response: Response,
    stream: boolean,
    onText: (text: string) => void
): Promise<ChatResult> {
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
}
```

#### After
```typescript
// src/client/chat-helpers.ts:22-64
/** Discriminated on `stream` so `raw` is only ever present for a
 * non-streaming call — callers narrow on the flag they already have
 * instead of re-checking `raw` at runtime. */
export type ChatResult =
    | { stream: false; raw: ChatResponseEnvelope; conversationId?: string }
    | { stream: true; conversationId?: string }

/** Shared response handling for both sendChat and retryChat. `emptyMessage`
 * names the caller in the thrown error for the one case this function
 * itself can't recover from (a 2xx non-streaming response with no body) —
 * thrown once here instead of every caller re-checking `!result.raw`. */
async function handleResponse(
    data: unknown,
    error: unknown,
    response: Response,
    stream: boolean,
    onText: (text: string) => void,
    emptyMessage: string
): Promise<ChatResult> {
    if (!stream) {
        throwIfError(response, error)
        const raw = data as unknown as ChatResponseEnvelope | undefined
        if (!raw) throw new Error(emptyMessage)
        return {
            stream: false,
            raw,
            conversationId: raw.data?.metadata?.conversationId
        }
    }

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
    return { stream: true, conversationId }
}
```
```typescript
// src/client/chat-helpers.ts — sendChat/retryChat gain an emptyMessage default
export async function sendChat(opts: {
    /* ...unchanged... */
}): Promise<ChatResult> {
    const { data, error, response } = await opts.client.POST(/* ... */)
    return handleResponse(
        data,
        error,
        response,
        opts.stream,
        opts.onText,
        'Chat response was empty'
    )
}

export async function retryChat(opts: {
    /* ...unchanged... */
}): Promise<ChatResult> {
    const { data, error, response } = await opts.client.POST(/* ... */)
    return handleResponse(
        data,
        error,
        response,
        opts.stream,
        opts.onText,
        'Retry response was empty'
    )
}
```
```typescript
// src/commands/chat/index.ts:101-110 and src/commands/chat/retry.ts:59-68 —
// the `else if (!result.raw) throw ...` guard is gone; TS now knows raw is
// present whenever result.stream is false
        if (result.stream) {
            process.stdout.write('\n')
        } else if (flags.json) {
            process.stdout.write(`${JSON.stringify(result.raw, null, 2)}\n`)
            return
        } else {
            process.stdout.write(`${extractText(result.raw)}\n`)
        }
```

#### Trade-off note
Touches 3 files and changes `ChatResult`'s shape (adds a required `stream` discriminant, removes the standalone optional `raw`), so `tests/client/chat-helpers.test.ts`, `chat-helpers-retry.test.ts`, and `tests/commands/chat-oneshot.test.ts` should be re-run against this change — none of them currently assert on the two-independent-optionals shape (checked: no test references `result.raw` being independently absent while streaming is false, or an "empty response" message string), so this should be a type-only tightening, but worth confirming. Pairs naturally with #2/#5's `runChatTurn` extraction — same code region, same PR.

---

## Cross-references

- **#10** (code-quality, 80) — Interactive `/retry`'s `messageId: 'last'` sentinel (`src/commands/chat/index.ts:201`) is the same defect as **#1** (correctness, 90), found independently by both agents. Verified independently: the OpenAPI spec's `RetryRequest.messageId` (`spec/openapi.json:3151-3156`) documents `minLength: 1` with an example of a real message ID (`msg-abc123`) and no mention of a sentinel value, so the comment at `chat/index.ts:188-190` claiming "the server interprets ['last'] as the last message" is unconfirmed by the contract. No separate solution written here — see #1's write-up (other agent) for the fix.

- **#3**, **#25** (mine) and **#11** (correctness, other agent) all stem from `parseSseStream`'s silent-failure design in `src/client/stream.ts`: #3 is the unhandled `'error'` event type, #25 is the swallowed malformed-JSON catch, and #11 additionally covers callers never reading `finishReason` and the parser dropping `'error'` events (same line range as #3, different lens). A single combined patch would extend `StreamEvent` with both `'error'` and `'parse-error'` variants (as shown in #3 and #25 above) and have `chat-helpers.ts`'s `handleResponse` treat a mid-stream `'error'` event as a thrown failure and check `finishReason` after the SSE loop ends — the `finishReason`/throw-on-error consumer-side piece belongs to #11's write-up.

- **#27** (mine, `ChatResult` typing) and **#2/#5** (mine, duplicated per-command chat-turn logic) touch the same code region (`chat-helpers.ts`'s `handleResponse` and both commands' `run()` methods) and are best implemented together in one pass, as noted in each entry's trade-off section.
