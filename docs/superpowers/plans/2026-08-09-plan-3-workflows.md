# Chatbase CLI — Plan 3: Workflows (Chat REPL + Sources Sync)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two flagship workflows: `chatbase chat` (one-shot + interactive REPL with SSE streaming) and `chatbase sources sync <dir>` (converge an agent's file sources to a local folder).

**Architecture:** A reusable SSE parser joins the client layer (`client/stream.ts`); chat commands sit on it. Sync is three isolated units — a pure diff engine, a plan renderer/confirmer, and a concurrent executor — wired together by a thin command. Nothing else in the CLI changes.

**Tech Stack:** Same as Plans 1–2. No new dependencies (REPL uses `node:readline`; globs use a ~20-line matcher, not a dependency).

**Prerequisites:** Plans 1–2 complete. Chat endpoint facts (verified in code 2026-08-09): `POST /agents/{agentId}/chat` body includes `stream: boolean` (default true) and returns `text/event-stream` when streaming; the stream is the AI-SDK UIMessage format — `data: <json>` lines with `type: 'text-delta'` parts carrying `delta`, a `message-metadata`/finish part carrying `{ conversationId, finishReason }`, terminated by `data: [DONE]`. The non-stream 200 returns the complete message JSON. Body field for input: verify against generated types (`paths['/agents/{agentId}/chat']['post']['requestBody']`) at Task 2 start — the generated type is the authority for field names (`messages` vs `message`, `conversationId`).

## Global Constraints (inherited)

- All Plan 1/2 constraints. Chat tokens → stdout; all status → stderr. REPL greeting must state exits (`/exit`, Ctrl-D; Ctrl-C cancels a response). Streaming idle timeout 60 s (not the 30 s total timeout). Sync: file-type sources only; concurrency 4; plan-confirm-execute; failures re-printed at end; exit non-zero if any operation failed; interrupted sync must converge on rerun.

## Consumed interfaces (from Plans 1–2)

- Plan 1: `BaseCommand`/`AgentCommand` + all protected helpers, `createApiClient`, `throwIfError`, `rawApiFetch`, `getSigintSignal`, `UsageError`/`ApiError`, `paint`/`colorEnabled`, `resolveApiKey`, `findProjectConfig`.
- Plan 2: `uploadFileSource({agentId, filePath, name?, apiKey, sourceId?, baseUrl?})` (files host), `listAllSources(client, agentId): Promise<SourceItem[]>` with `SourceItem = { id, type, name, size, status }` (from `src/commands/sources/shared.ts`), `readBodyData`.

---

### Task 1: SSE stream parser (`client/stream.ts`)

**Files:**
- Create: `src/client/stream.ts`
- Test: `tests/client/stream.test.ts`

**Interfaces:**
- Produces:
  - `type StreamEvent = { type: 'text'; text: string } | { type: 'tool'; name: string } | { type: 'metadata'; conversationId?: string; finishReason?: string } | { type: 'done' }`
  - `parseSseStream(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void, opts?: { idleTimeoutMs?: number }): Promise<void>` — resolves at `[DONE]`/stream end; rejects with `ApiError`-style Error on idle timeout (default 60 000 ms). Tolerant: unknown part types are ignored; multi-line/partial chunks are buffered correctly.

- [ ] **Step 1: Write failing tests**

`tests/client/stream.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSseStream, type StreamEvent } from '../../src/client/stream.js'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder()
    return new ReadableStream({
        start(controller) {
            for (const c of chunks) controller.enqueue(enc.encode(c))
            controller.close()
        }
    })
}

it('emits text deltas, metadata, and done', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf([
            'data: {"type":"text-delta","delta":"Hel"}\n\n',
            'data: {"type":"text-delta","delta":"lo"}\n\n',
            'data: {"type":"message-metadata","messageMetadata":{"conversationId":"c_9","finishReason":"stop"}}\n\n',
            'data: [DONE]\n\n'
        ]),
        (e) => events.push(e)
    )
    expect(events).toEqual([
        { type: 'text', text: 'Hel' },
        { type: 'text', text: 'lo' },
        { type: 'metadata', conversationId: 'c_9', finishReason: 'stop' },
        { type: 'done' }
    ])
})

it('handles events split across chunk boundaries', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf(['data: {"type":"text-del', 'ta","delta":"x"}\n\ndata: [DONE]\n\n']),
        (e) => events.push(e)
    )
    expect(events[0]).toEqual({ type: 'text', text: 'x' })
})

it('ignores unknown part types', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf(['data: {"type":"future-thing"}\n\ndata: [DONE]\n\n']),
        (e) => events.push(e)
    )
    expect(events).toEqual([{ type: 'done' }])
})

it('rejects on idle timeout', async () => {
    const never = new ReadableStream<Uint8Array>({ start() {} })
    await expect(parseSseStream(never, () => {}, { idleTimeoutMs: 50 })).rejects.toThrow(/idle/i)
})
```

- [ ] **Step 2: Run → FAIL, implement**

`src/client/stream.ts`:

```ts
export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'tool'; name: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
    | { type: 'done' }

export async function parseSseStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (e: StreamEvent) => void,
    opts: { idleTimeoutMs?: number } = {}
): Promise<void> {
    const idleMs = opts.idleTimeoutMs ?? 60_000
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const idle = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Stream idle timeout — no data for 60s')), idleMs)
        })
        const result = await Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer))
        const { done, value } = result as ReadableStreamReadResult<Uint8Array>
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            for (const line of block.split('\n')) {
                if (!line.startsWith('data: ')) continue
                const payload = line.slice(6)
                if (payload === '[DONE]') {
                    onEvent({ type: 'done' })
                    return
                }
                let part: Record<string, unknown>
                try {
                    part = JSON.parse(payload) as Record<string, unknown>
                } catch {
                    continue
                }
                if (part.type === 'text-delta' && typeof part.delta === 'string') {
                    onEvent({ type: 'text', text: part.delta })
                } else if (part.type === 'message-metadata' || part.type === 'finish') {
                    const meta = (part.messageMetadata ?? {}) as { conversationId?: string; finishReason?: string }
                    onEvent({ type: 'metadata', conversationId: meta.conversationId, finishReason: meta.finishReason })
                } else if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
                    onEvent({ type: 'tool', name: String(part.toolName ?? part.type) })
                }
            }
        }
    }
}
```

- [ ] **Step 3: PASS + commit**

```bash
npx vitest run tests/client/stream.test.ts && npm run typecheck
git add -A && git commit -m "feat: SSE stream parser for AI-SDK UIMessage streams"
```

---

### Task 2: `chat` one-shot

**Files:**
- Create: `src/commands/chat.ts` (one-shot path; the REPL arrives in Task 3 behind the same command)
- Test: `tests/commands/chat-oneshot.test.ts`

**Interfaces:**
- Consumes: `parseSseStream`, `AgentCommand`, typed client POST `/agents/{agentId}/chat`. Verify request body field names from generated types first (assume `{ messages: [{ role: 'user', content }], conversationId?, stream }`; adjust to the authority).
- Produces: flags `-m/--message`, `--conversation <id>`, `--no-stream`; behavior contract: message from `-m`, else from piped stdin, else (TTY) → REPL (Task 3; until then print a "REPL arrives in the next task" UsageError). Tokens → stdout as they arrive; on completion, conversation ID + resume hint → stderr. `--json` forces `stream: false` and prints the full response JSON. `--no-stream` prints the complete text once.

- [ ] **Step 1: Failing tests** — streaming responses via MockAgent replying with an SSE body string and `content-type: text/event-stream`:

```ts
const sse = [
    'data: {"type":"text-delta","delta":"Hi "}\n\n',
    'data: {"type":"text-delta","delta":"there"}\n\n',
    'data: {"type":"message-metadata","messageMetadata":{"conversationId":"c_77"}}\n\n',
    'data: [DONE]\n\n'
].join('')

it('streams tokens to stdout and prints the conversation hint to stderr', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
        .reply(200, sse, { headers: { 'content-type': 'text/event-stream' } })
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await Chat.run(['-a', 'agt_1', '-m', 'hello'], process.cwd())
    expect(out.mock.calls.join('')).toBe('Hi there\n')
    expect(err.mock.calls.join('')).toContain('c_77')
})

it('--json disables streaming and prints raw response', async () => {
    let sent = ''
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
        .reply(200, function (o) { sent = String(o.body); return { data: { text: 'Hi', conversationId: 'c_1' } } })
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await Chat.run(['-a', 'agt_1', '-m', 'hello', '--json'], process.cwd())
    expect(JSON.parse(sent)).toMatchObject({ stream: false })
    expect(JSON.parse(out.mock.calls.join(''))).toMatchObject({ data: { text: 'Hi' } })
})

it('reads the message from piped stdin when -m is absent', async () => {
    // stub stdin as non-TTY Readable with 'explain this' (Plan 1 auth test helper pattern)
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
        .reply(200, sse, { headers: { 'content-type': 'text/event-stream' } })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await Chat.run(['-a', 'agt_1'], process.cwd())
})
```

- [ ] **Step 2: Implement the one-shot path** — `sendMessage()` helper inside `chat.ts` shared with the REPL:

```ts
async function sendChat(opts: {
    client: ReturnType<BaseCommand['apiClient']>
    agentId: string
    message: string
    conversationId?: string
    stream: boolean
    onText: (t: string) => void
}): Promise<{ conversationId?: string; raw?: unknown }> {
    const { data, error, response } = await opts.client.POST('/agents/{agentId}/chat', {
        params: { path: { agentId: opts.agentId } },
        body: {
            messages: [{ role: 'user', content: opts.message }],
            conversationId: opts.conversationId,
            stream: opts.stream
        } as never,
        parseAs: opts.stream ? 'stream' : 'json'
    })
    if (!opts.stream) {
        throwIfError(response, error)
        return { raw: data, conversationId: (data as { data?: { conversationId?: string } })?.data?.conversationId }
    }
    if (!response.ok) throwIfError(response, await response.json().catch(() => undefined))
    let conversationId: string | undefined
    await parseSseStream(response.body!, (e) => {
        if (e.type === 'text') opts.onText(e.text)
        if (e.type === 'metadata') conversationId = e.conversationId ?? conversationId
    })
    return { conversationId }
}
```

Command `run()`: resolve message (`-m` → stdin non-TTY read → else REPL in Task 3); stream unless `--json`/`--no-stream`; after streaming write `\n` to stdout and `Conversation: <id> — resume with: chatbase chat -a <agent> --conversation <id>` via `note()`.

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: chat one-shot with SSE streaming, --json, stdin piping"
```

---

### Task 3: Chat REPL

**Files:**
- Modify: `src/commands/chat.ts` (add REPL path)
- Create: `src/repl/chat-repl.ts`
- Test: `tests/repl/chat-repl.test.ts`

**Interfaces:**
- Produces: `runChatRepl(deps: { send: (message: string, conversationId?: string) => Promise<{ conversationId?: string }>; retry: (conversationId: string) => Promise<void>; input: NodeJS.ReadableStream; output: NodeJS.WritableStream; info: (msg: string) => void }): Promise<{ conversationId?: string }>` — dependency-injected so tests drive it with fake streams; the command wires real stdin/stdout/`sendChat`.
- Behavior: greeting states exits; slash commands `/exit` (also Ctrl-D), `/new`, `/retry`, `/id`, `/help`; unknown `/cmd` → hint; empty line ignored; Ctrl-C during a response aborts that response only (per-response `AbortController` passed into `send` — extend `sendChat` with optional `signal`); Ctrl-C at empty prompt exits. On exit, return the conversationId (command prints resume hint).

- [ ] **Step 1: Failing tests** — drive the REPL with a scripted input stream:

```ts
import { PassThrough } from 'node:stream'
import { runChatRepl } from '../../src/repl/chat-repl.js'

function scripted(lines: string[]): PassThrough {
    const s = new PassThrough()
    setImmediate(() => {
        for (const l of lines) s.write(`${l}\n`)
        s.end()
    })
    return s
}

it('sends lines, tracks conversation id, /id prints it, /exit ends', async () => {
    const sent: string[] = []
    const infos: string[] = []
    const result = await runChatRepl({
        send: async (m) => { sent.push(m); return { conversationId: 'c_1' } },
        retry: async () => {},
        input: scripted(['hello', '/id', '/exit']),
        output: new PassThrough(),
        info: (m) => infos.push(m)
    })
    expect(sent).toEqual(['hello'])
    expect(infos.join('\n')).toContain('c_1')
    expect(result.conversationId).toBe('c_1')
})

it('/new clears the conversation id', async () => {
    const convs: Array<string | undefined> = []
    await runChatRepl({
        send: async (_m, c) => { convs.push(c); return { conversationId: 'c_2' } },
        retry: async () => {},
        input: scripted(['a', '/new', 'b', '/exit']),
        output: new PassThrough(),
        info: () => {}
    })
    expect(convs).toEqual([undefined, undefined])  // second send starts fresh
})

it('/retry calls retry with the current conversation', async () => {
    const retried: string[] = []
    await runChatRepl({
        send: async () => ({ conversationId: 'c_3' }),
        retry: async (c) => { retried.push(c) },
        input: scripted(['x', '/retry', '/exit']),
        output: new PassThrough(),
        info: () => {}
    })
    expect(retried).toEqual(['c_3'])
})
```

- [ ] **Step 2: Implement `runChatRepl`** with `node:readline` (`rl.on('line')`, `rl.on('close')` = Ctrl-D). Greeting via `info('Type /exit or press Ctrl-D to quit. Ctrl-C cancels a response. /help for commands.')`. Wire into `chat.ts`: TTY + no `-m` → build deps (send → `sendChat` with per-call AbortController chained to SIGINT for cancel-current-response; retry → POST `.../conversations/{id}/retry` streaming to stdout) and print the exit hint + resume command on completion.

- [ ] **Step 3: Manual smoke** (documented, not CI): `npm run build && node bin/run.js chat -a <real-agent>` — verify greeting, streaming render, `/retry`, Ctrl-C mid-response returns to prompt, Ctrl-D exits with hint.

- [ ] **Step 4: PASS + commit**

```bash
npx vitest run tests/repl && npm run typecheck
git add -A && git commit -m "feat: interactive chat REPL with slash commands and cancel semantics"
```

---

### Task 4: `chat retry`

**Files:**
- Create: `src/commands/chat/retry.ts`
- Test: `tests/commands/chat-retry.test.ts`

**Interfaces:**
- Consumes: `POST /agents/{agentId}/conversations/{conversationId}/retry` (same streaming response as chat), `parseSseStream`, `sendChat`'s streaming logic (factor the retry POST into the shared helper file so REPL `/retry` and this command share it: export `retryChat(opts: { client; agentId; conversationId; stream; onText }): Promise<{ conversationId?: string }>` from `src/commands/chat.ts` or a new `src/client/chat-helpers.ts` — **decision: `src/client/chat-helpers.ts`**, move `sendChat` there too, named exports `sendChat`/`retryChat`).

- [ ] **Step 1: Failing test** — `chat retry --conversation c_1 -a agt_1` streams the retried answer to stdout (SSE mock identical to Task 2's).
- [ ] **Step 2: Implement** — thin command over `retryChat`; refactor Task 2/3 imports to `chat-helpers.js`; all chat tests still green.
- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: chat retry command; extract shared chat helpers"
```

---

### Task 5: Sync diff engine (pure)

**Files:**
- Create: `src/sync/diff.ts`
- Test: `tests/sync/diff.test.ts`

**Interfaces:**
- Consumes: `SourceItem` (Plan 2 Task 5).
- Produces:
  - `type LocalFile = { relPath: string; size: number; absPath: string }`
  - `type SyncPlan = { create: LocalFile[]; update: Array<LocalFile & { sourceId: string }>; del: Array<{ sourceId: string; name: string }>; unchanged: number; caseCollisions: string[] }`
  - `scanDir(dir: string, opts: { include: string[]; exclude: string[] }): LocalFile[]` — recursive walk; include/exclude by glob-ish matching (`*` within segment, `**` across segments); defaults documented below.
  - `computeSyncPlan(local: LocalFile[], remote: SourceItem[]): SyncPlan` — **file-type sources only**; keyed by `name === relPath`; size mismatch → update; remote-only file sources → delete; non-file sources ignored entirely; case-insensitive duplicate relPaths → `caseCollisions`.
- Default include: `['**/*.pdf', '**/*.md', '**/*.txt', '**/*.docx', '**/*.doc', '**/*.html']`; default exclude: `['**/.*', '**/.*/**', '**/node_modules/**']`. Overridable via `chatbase.json` `sync.include`/`sync.exclude` (Task 7).

- [ ] **Step 1: Failing tests**

```ts
import { computeSyncPlan } from '../../src/sync/diff.js'

const rf = (name: string, size: number, type = 'file', id = `src_${name}`) => ({ id, type, name, size, status: 'trained' })
const lf = (relPath: string, size: number) => ({ relPath, size, absPath: `/x/${relPath}` })

it('creates local-only, deletes remote-only, updates size mismatches, skips matches', () => {
    const plan = computeSyncPlan(
        [lf('a.md', 10), lf('b.md', 20), lf('c.md', 30)],
        [rf('b.md', 20), rf('c.md', 99), rf('gone.md', 5)]
    )
    expect(plan.create.map((f) => f.relPath)).toEqual(['a.md'])
    expect(plan.update.map((f) => f.relPath)).toEqual(['c.md'])
    expect(plan.del.map((d) => d.name)).toEqual(['gone.md'])
    expect(plan.unchanged).toBe(1)
})

it('never touches non-file sources', () => {
    const plan = computeSyncPlan([], [rf('faq', 1, 'qna'), rf('site', 1, 'link'), rf('note', 1, 'text')])
    expect(plan.del).toEqual([])
})

it('flags case-insensitive collisions', () => {
    const plan = computeSyncPlan([lf('Readme.md', 1), lf('readme.md', 2)], [])
    expect(plan.caseCollisions).toEqual(['readme.md'])
})
```

Plus `scanDir` tests against a mkdtemp fixture tree (respects include/exclude, skips dotfiles, returns sizes).

- [ ] **Step 2: Implement** — pure functions, no I/O in `computeSyncPlan`; `scanDir` uses `fs.readdirSync` recursion + a small `matchGlob(pattern, relPath)` (segment-wise `*`, `**` handling, ~20 lines).

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: pure sync diff engine with globs and case-collision detection"
```

---

### Task 6: Sync executor — plan rendering, confirmation, concurrent apply

**Files:**
- Create: `src/sync/execute.ts`, `src/sync/render.ts`
- Test: `tests/sync/execute.test.ts`

**Interfaces:**
- Consumes: `SyncPlan`, `uploadFileSource` (Plan 2), typed client DELETE `.../sources/{sourceId}`.
- Produces:
  - `renderPlan(plan: SyncPlan, color: Palette): string` — git-push style: `+3 created  ~2 updated  −1 deleted  (4 unchanged)` plus per-file lines.
  - `executeSyncPlan(plan: SyncPlan, deps: { agentId: string; apiKey: string; client: Client<paths>; concurrency?: number; onProgress: (line: string) => void }): Promise<{ failures: Array<{ name: string; error: string }>; applied: number }>` — concurrency-4 worker pool over create+update (uploads) then deletes; every completion calls `onProgress`; failures collected, never thrown mid-run.

- [ ] **Step 1: Failing tests** — fake `uploadFileSource` via MockAgent on the files host + DELETE mocks on the main host; assert: all operations attempted, `applied` counts successes, one failing upload appears in `failures` while others complete, concurrency never exceeds 4 (track with a counter in intercept callbacks).

- [ ] **Step 2: Implement** — small promise-pool (`async function pool<T>(items: T[], n: number, worker: (t: T) => Promise<void>)`), sequential-ish deletes after uploads; `renderPlan` builds the summary + file lines with `+ ~ −` prefixes.

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: sync executor with concurrency pool and failure collection"
```

---

### Task 7: `sources sync` command

**Files:**
- Create: `src/commands/sources/sync.ts`
- Modify: `src/config/project.ts` (parse `sync.include`/`sync.exclude`/`sync.dir` from `chatbase.json` — extend `ProjectConfig` with `sync?: { dir?: string; include?: string[]; exclude?: string[] }`)
- Test: `tests/commands/sources-sync.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–6 + `listAllSources` + `AgentCommand`.
- Behavior contract (spec §13): positional `dir` (falls back to project config `sync.dir`); `--dry-run/-n` prints plan only (exit 0); TTY → y/N prompt (typed agent-ID escalation when `plan.del.length > 0.5 × remote file-source count`); non-TTY/`--no-input` requires `--force`; `--force` skips all prompts; case collisions → yellow warning listing paths; failures re-printed at end; exit 1 if any failure; success summary `✓ Synced: +3 ~2 −1 (4 unchanged)`; interrupted run converges on rerun (no state, guaranteed by design).

- [ ] **Step 1: Failing tests** — six cases: dry-run prints plan and calls nothing; `--force` applies (MockAgent asserts uploads+deletes happened); refusal without `--force` when non-TTY (exit 2); >50 %-delete plan without `--force` non-TTY names the typed-confirmation requirement in its error; failure path exits 1 and re-prints the failed file; `sync.dir` from a fixture `chatbase.json` is used when no positional given.

- [ ] **Step 2: Implement** — wire scan → plan → render → confirm → execute → summarize. Confirmation prompt via `@inquirer/prompts` `confirm` / `input` (dynamic import, mirroring `agents delete`).

- [ ] **Step 3: Full regression + commit**

```bash
npm run lint && npm test && npm run build && node scripts/check-startup.mjs
git add -A && git commit -m "feat: sources sync — converge agent file sources to a local folder"
```

---

## Self-review

- **Coverage vs spec:** §11 REPL (Tasks 2–3: streaming, slash commands, cancel semantics, resume hints) ✓ · §13 sync (Tasks 5–7: file-only scoping, stateless diff, plan/confirm tiers, concurrency 4, failure re-print, convergence) ✓ · robustness rules (idle timeout Task 1, no-hang stdin Task 2, Ctrl-C tiers Task 3) ✓.
- **Placeholders:** none — every module has real code or names the exact task in THIS plan whose shape it copies; the one deliberately deferred verification (chat request body field names) is marked "generated type is the authority" with the exact type path to check.
- **Type consistency:** `StreamEvent`/`parseSseStream` (Task 1) consumed in Tasks 2–4; `sendChat`/`retryChat` land in `src/client/chat-helpers.ts` (Task 4 refactor); `SyncPlan`/`LocalFile` (Task 5) consumed by Tasks 6–7; `SourceItem`/`uploadFileSource`/`listAllSources` names match Plan 2 exactly.
