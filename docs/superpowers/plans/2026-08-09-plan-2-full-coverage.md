# Chatbase CLI — Plan 2: Full Command Coverage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every API v2 operation exposed as a CLI command — agents, sources (including file uploads via the files host), conversations get/export, messages, tools, tickets/helpdesk — plus the `api` escape hatch and the `config`/`docs` utility commands.

**Architecture:** Pure extension of Plan 1's skeleton: every command is a small file extending `BaseCommand`/`AgentCommand`/`ListCommand`, calling the typed `openapi-fetch` client, and printing through `printData`. No new architectural concepts except one: a multipart upload helper for the files host (`files.chatbase.co`), whose endpoints are NOT in the OpenAPI spec (they live in the separate `chatbase-server` service).

**Tech Stack:** Same as Plan 1. No new dependencies.

**Prerequisites:** Plan 1 complete (all its interfaces exist and its tests pass). Written against Plan 1's *planned* interfaces — if execution deviated, reconcile signatures before starting.

## Global Constraints (inherited from the spec + Plan 1)

- All Plan 1 global constraints apply (stream discipline, exit codes 0/1/2, output modes, color rules, no secrets via flags, prompts only on TTY).
- Verb set is closed: `list get create update delete` + `restore export sync retry clone train reply`. `messages feedback` is the recorded noun-exception.
- Max one positional arg per command (primary resource ID); multi-ID commands use flags.
- `--plain`/pretty column orders defined here are append-only interface from now on.
- Pagination trio `--limit/--cursor/--all` + stderr next-page hint on every list command, identical to `conversations list` (Plan 1 Task 10).
- Files host: `https://files.chatbase.co/api/v2` (constant `FILES_BASE_URL`).

## Consumed interfaces (defined in Plan 1 — exact signatures)

- `BaseCommand`: `baseFlags`, `mode(flags)`, `palette(flags)`, `note(flags, msg)`, `success(flags, msg)`, `printData(flags, raw, rows, columns)`, `apiClient(flags)`, `requireAuth`
- `AgentCommand`: adds `agent` flag (`-a`), `agentId(flags): string`
- `ListCommand`: adds `limit/cursor/all` flags
- `client/client.ts`: `createApiClient(opts)`, `rawApiFetch(method, path, opts)`, `throwIfError(response, error)`, `buildUserAgent()`, `DEFAULT_BASE_URL`
- `errors/errors.ts`: `ApiError`, `UsageError`, `parseErrorResponse(status, body, requestId?)`
- `config/store.ts`: `readUserConfig()`, `writeUserConfig(c)`; `config/resolve.ts`: `resolveApiKey()`, `resolveAgent(flag?, cwd?)`; `config/project.ts`: `findProjectConfig(startDir?)`
- `output/render.ts`: `type Column`, `renderTable`, `renderPlain`
- Test seams: undici `MockAgent` + `setGlobalDispatcher`; commands run via `CommandClass.run(argv, process.cwd())` with `vi.spyOn(process.stdout/stderr, 'write')`.

---

### Task 1: Spec refresh + endpoint survey guard

**Files:**
- Modify: `spec/openapi.json`, `src/generated/api.d.ts` (regenerated), `tests/generated/types.test.ts`

**Interfaces:**
- Produces: current types for all 25 paths; a documented survey habit.

- [ ] **Step 1: Re-survey the API** (spec §19 standing rule)

Run in `../chatbase`: `grep -rE "^\s+path: '" src/lib/api/v2/routes --include="*.route.ts" -h | sort -u | wc -l`
Compare against `spec/openapi.json` path count. If they differ, the API changed since Plan 2 was written — list the new paths and add commands for them to this plan before proceeding.

- [ ] **Step 2: Refresh the vendored spec**

Run: `npm run spec:refresh && npm run spec:check && npm run typecheck && npm test`
Expected: 25+ paths vendored; existing Plan 1 tests still green (if compile errors appear, an endpoint this CLI uses changed shape — fix the affected command as part of this step).

- [ ] **Step 3: Extend type assertions**

Add to `tests/generated/types.test.ts`:

```ts
type CreateAgentOp = paths['/agents']['post']
type TicketsOp = paths['/agents/{agentId}/helpdesk/tickets']['get']
const agentsCreatable: CreateAgentOp extends { requestBody?: unknown } ? true : false = true
const ticketsPresent: TicketsOp extends { responses: { 200: unknown } } ? true : false = true
```

Assert both `toBe(true)` in the existing test. Run: `npx vitest run tests/generated && npm run typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: refresh vendored spec to full API surface"
```

---

### Task 2: `agents list` / `agents get`

**Files:**
- Create: `src/commands/agents/list.ts`, `src/commands/agents/get.ts`
- Test: `tests/commands/agents-read.test.ts`

**Interfaces:**
- Consumes: `ListCommand`, `BaseCommand`, typed client. Response `Agent` fields (from spec): `id, name, model, visibility, autoRetrain, ...`; `ListAgentsResponse = { data: Agent[], pagination }`.
- Produces: agents pretty/plain columns (append-only): `id, name, model, visibility`.
- Note: `agents list` and `agents get <id>` take NO `-a` flag — the agent IS the resource. `list` extends `BaseCommand` + pagination flags declared locally (copy of the trio), or extend `ListCommand` and ignore `agentId()`; **decision: extend `BaseCommand` and declare `limit/cursor/all` locally** to avoid a misleading `-a` flag in help.

- [ ] **Step 1: Write failing tests**

`tests/commands/agents-read.test.ts` (same MockAgent scaffolding as Plan 1's `conversations-list` test — `beforeEach` creates `MockAgent`, `disableNetConnect`, `setGlobalDispatcher`, stubs `CHATBASE_API_KEY=sk-test`; `afterEach` closes and restores):

```ts
import AgentsGet from '../../src/commands/agents/get.js'
import AgentsList from '../../src/commands/agents/list.js'

const agent = { id: 'agt_1', name: 'Support Bot', model: 'gpt-5', visibility: 'private', autoRetrain: false }

it('agents list renders plain rows', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents', method: 'GET' })
        .reply(200, { data: [agent], pagination: { cursor: null, hasMore: false, total: 1 } })
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await AgentsList.run(['--plain'], process.cwd())
    expect(out.mock.calls.join('')).toContain('agt_1\tSupport Bot\tgpt-5\tprivate')
})

it('agents get prints one agent as JSON with --json', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1', method: 'GET' }).reply(200, { data: agent })
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await AgentsGet.run(['agt_1', '--json'], process.cwd())
    expect(JSON.parse(out.mock.calls.join(''))).toEqual({ data: agent })
})
```

Run: `npx vitest run tests/commands/agents-read.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement**

`src/commands/agents/list.ts`:

```ts
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'model', header: 'MODEL' },
    { key: 'visibility', header: 'VISIBILITY' }
]

export default class AgentsList extends BaseCommand {
    static override description = 'List all agents in the workspace'
    static override examples = ['<%= config.bin %> agents list', '<%= config.bin %> agents list --json']
    static override flags = {
        ...BaseCommand.baseFlags,
        limit: Flags.integer({ description: 'Maximum items per page' }),
        cursor: Flags.string({ description: 'Pagination cursor from a previous page' }),
        all: Flags.boolean({ description: 'Fetch every page' })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(AgentsList)
        const client = this.apiClient(flags)
        type Page = { data: Array<Record<string, unknown>>; pagination: { cursor?: string | null; hasMore: boolean } }
        const pages: Page[] = []
        let cursor = flags.cursor
        for (;;) {
            const { data, error, response } = await client.GET('/agents', {
                params: { query: { cursor, limit: flags.limit } }
            })
            throwIfError(response, error)
            const page = data as unknown as Page
            pages.push(page)
            if (!flags.all || !page.pagination.hasMore || !page.pagination.cursor) break
            cursor = page.pagination.cursor
        }
        const rows = pages.flatMap((p) =>
            p.data.map((a) => ({
                id: String(a.id ?? ''),
                name: String(a.name ?? ''),
                model: String(a.model ?? ''),
                visibility: String(a.visibility ?? '')
            }))
        )
        const last = pages.at(-1)
        this.printData(flags, pages.length === 1 ? pages[0] : { data: rows, pagination: last?.pagination }, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(flags, `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`)
        }
    }
}
```

`src/commands/agents/get.ts`:

```ts
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'

export default class AgentsGet extends BaseCommand {
    static override description = 'Show one agent'
    static override examples = ['<%= config.bin %> agents get agt_123']
    static override args = { agentId: Args.string({ required: true, description: 'Agent ID' }) }
    static override flags = { ...BaseCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsGet)
        const client = this.apiClient(flags)
        const { data, error, response } = await client.GET('/agents/{agentId}', {
            params: { path: { agentId: args.agentId } }
        })
        throwIfError(response, error)
        const a = (data as { data: Record<string, unknown> }).data
        this.printData(flags, data, [
            { id: String(a.id), name: String(a.name), model: String(a.model ?? ''), visibility: String(a.visibility ?? '') }
        ], [
            { key: 'id', header: 'ID' }, { key: 'name', header: 'NAME' },
            { key: 'model', header: 'MODEL' }, { key: 'visibility', header: 'VISIBILITY' }
        ])
    }
}
```

- [ ] **Step 3: Run tests, verify pass, commit**

Run: `npx vitest run tests/commands/agents-read.test.ts && npm run typecheck`
(If the generated response type wraps the agent differently than `{ data: Agent }`, follow the generated type — it is the authority; adjust the unwrap and the test fixture together.)

```bash
git add -A && git commit -m "feat: agents list/get"
```

---

### Task 2b: Agent name resolution (added 2026-08-11, user decision)

**Files:**
- Create: `src/base/agent-ref.ts` — `resolveAgentRef(client, ref: string): Promise<string>`
- Modify: `src/base/agent-command.ts` (`agentId()` uses it for the FLAG value only), Task 10's `config set agent` (interactive picker)
- Test: `tests/base/agent-ref.test.ts`

**Contract (Option A from review discussion):** the `-a` flag accepts an agent ID or an exact display name. IDs pass through untouched (zero extra requests — match against a fetched list only when the value fails an ID-shaped fast path or the direct use 404s… simplest deterministic rule: fetch `GET /agents` pages once, match `id` first, then exact `name`). Name matched once → proceed, echoing `→ <id>` via note() so users learn the ID to pin in scripts; multiple matches → UsageError listing candidates with IDs; none → UsageError suggesting `chatbase agents list`. Env var, `chatbase.json`, and user config remain **ID-only** (names are for fingers, IDs are for scripts — renames must never silently retarget durable config). Scoped keys lacking `agents:read` will surface PERMISSION_DENIED from the list call — acceptable, remediation already exists. Task 10 addition: `config set agent` with no value presents a numbered picker over the same list.

---

### Task 3: `agents create` / `update` / `delete` / `clone`

**Files:**
- Create: `src/commands/agents/create.ts`, `src/commands/agents/update.ts`, `src/commands/agents/delete.ts`, `src/commands/agents/clone.ts`
- Test: `tests/commands/agents-write.test.ts`

**Interfaces:**
- Consumes: `CreateAgentBody` (spec: at minimum `name`, `instructions`; optional `model`, `temp`, `visibility`, ...); severe-tier confirmation rule from the spec §4.
- Produces: `--confirm <agentId>` convention for severe deletes; `--data @file.json` / `--data @-` convention for rich create/update bodies (JSON passed whole, validated by the API).

Body input convention (applies to every create/update command in this plan): simple scalars get dedicated flags; the full body can always be given as raw JSON via `--data @file.json`, `--data @-` (stdin, with the Plan 1 no-hang TTY guard), or `--data '{"inline":"json"}'`. Dedicated flags override keys in `--data`.

- [ ] **Step 1: Write failing tests**

`tests/commands/agents-write.test.ts` (standard MockAgent scaffolding):

```ts
it('agents create posts name/instructions and prints the id on stdout', async () => {
    let sentBody = ''
    mock.get(BASE).intercept({ path: '/api/v2/agents', method: 'POST' })
        .reply(201, function (opts) { sentBody = String(opts.body); return { data: { id: 'agt_new' } } })
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await AgentsCreate.run(['--name', 'Bot', '--instructions', 'Be helpful', '--quiet'], process.cwd())
    expect(JSON.parse(sentBody)).toMatchObject({ name: 'Bot', instructions: 'Be helpful' })
    expect(out.mock.calls.join('')).toBe('agt_new\n')
})

it('agents delete refuses without --confirm when not a TTY', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await expect(AgentsDelete.run(['agt_1'], process.cwd())).rejects.toMatchObject({ oclif: { exit: 2 } })
})

it('agents delete works with --confirm matching the id', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1', method: 'DELETE' }).reply(200, { data: { deleted: true } })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await AgentsDelete.run(['agt_1', '--confirm', 'agt_1'], process.cwd())
})

it('agents delete rejects a mismatched --confirm', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await expect(AgentsDelete.run(['agt_1', '--confirm', 'agt_2'], process.cwd()))
        .rejects.toMatchObject({ oclif: { exit: 2 } })
})

it('agents clone posts to /clone and prints the new id', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/clone', method: 'POST' }).reply(201, { data: { id: 'agt_copy' } })
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await AgentsClone.run(['agt_1', '--quiet'], process.cwd())
    expect(out.mock.calls.join('')).toBe('agt_copy\n')
})
```

Run to verify FAIL.

- [ ] **Step 2: Implement the shared body helper + four commands**

Add to `src/base/body-input.ts` (new small module):

```ts
import fs from 'node:fs'
import { UsageError } from '../errors/errors.js'

/** Resolve --data into an object: @file.json, @- (stdin), or inline JSON. */
export async function readBodyData(data?: string): Promise<Record<string, unknown>> {
    if (!data) return {}
    let raw: string
    if (data === '@-') {
        if (process.stdin.isTTY) throw new UsageError('--data @- expects piped stdin.')
        raw = ''
        for await (const chunk of process.stdin) raw += chunk
    } else if (data.startsWith('@')) {
        raw = fs.readFileSync(data.slice(1), 'utf8')
    } else {
        raw = data
    }
    try {
        return JSON.parse(raw) as Record<string, unknown>
    } catch {
        throw new UsageError('--data must be valid JSON (inline, @file, or @-).')
    }
}
```

`src/commands/agents/create.ts`:

```ts
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'

export default class AgentsCreate extends BaseCommand {
    static override description = 'Create a new agent'
    static override examples = [
        '<%= config.bin %> agents create --name "Support Bot" --instructions "Be helpful"',
        '<%= config.bin %> agents create --data @agent.json'
    ]
    static override flags = {
        ...BaseCommand.baseFlags,
        name: Flags.string({ description: 'Agent name' }),
        instructions: Flags.string({ description: 'System instructions' }),
        model: Flags.string({ description: 'Model ID' }),
        data: Flags.string({ description: 'Full JSON body (@file, @-, or inline)' })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(AgentsCreate)
        const body = {
            ...(await readBodyData(flags.data)),
            ...(flags.name ? { name: flags.name } : {}),
            ...(flags.instructions ? { instructions: flags.instructions } : {}),
            ...(flags.model ? { model: flags.model } : {})
        }
        const client = this.apiClient(flags)
        const { data, error, response } = await client.POST('/agents', { body: body as never })
        throwIfError(response, error)
        const id = (data as { data: { id: string } }).data.id
        this.success(flags, `Created agent ${id}`)
        process.stdout.write(`${id}\n`)
    }
}
```

`src/commands/agents/delete.ts` (the severe-tier pattern):

```ts
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'

export default class AgentsDelete extends BaseCommand {
    static override description = 'Permanently delete an agent (cannot be undone)'
    static override examples = ['<%= config.bin %> agents delete agt_123 --confirm agt_123']
    static override args = { agentId: Args.string({ required: true, description: 'Agent ID' }) }
    static override flags = {
        ...BaseCommand.baseFlags,
        confirm: Flags.string({ description: 'Confirm by repeating the agent ID (required when not interactive)' })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsDelete)
        if (flags.confirm !== args.agentId) {
            if (flags.confirm) throw new UsageError(`--confirm value does not match ${args.agentId}.`)
            if (!process.stdin.isTTY || flags['no-input']) {
                throw new UsageError(`Deleting an agent is permanent. Re-run with --confirm ${args.agentId}`)
            }
            const { input } = await import('@inquirer/prompts')
            const typed = await input({ message: `Type the agent ID (${args.agentId}) to confirm deletion:` })
            if (typed.trim() !== args.agentId) throw new UsageError('Confirmation did not match; aborted.')
        }
        const client = this.apiClient(flags)
        const { error, response } = await client.DELETE('/agents/{agentId}', {
            params: { path: { agentId: args.agentId } }
        })
        throwIfError(response, error)
        this.success(flags, `Deleted agent ${args.agentId}`)
    }
}
```

`src/commands/agents/update.ts`: same shape as create but `PUT /agents/{agentId}` with `Args.string agentId` + flags `name/instructions/model/data`; prints `✓ Updated agent <id>`. `src/commands/agents/clone.ts`: `POST /agents/{agentId}/clone`, positional `agentId`, prints new id on stdout + `✓ Cloned agent <old> → <new>` on stderr — code identical in structure to create (no body flags).

- [ ] **Step 3: Run tests → PASS, lint, commit**

```bash
npx vitest run tests/commands/agents-write.test.ts && npm run typecheck
git add -A && git commit -m "feat: agents create/update/delete/clone with severe-tier delete confirmation"
```

---

### Task 4: `agents train` / `auto-retrain` / `styles`

**Files:**
- Create: `src/commands/agents/train.ts`, `src/commands/agents/auto-retrain.ts`, `src/commands/agents/styles.ts`
- Test: `tests/commands/agents-ops.test.ts`

**Interfaces:**
- Consumes: `POST /agents/{agentId}/train` (no body), `PUT /agents/{agentId}/auto-retrain` (`UpdateAgentAutoRetrainBody`, boolean field), `PUT /agents/{agentId}/styles` (`UpdateAgentStylesBody` via `--data`).

- [ ] **Step 1: Failing tests** — three cases in `tests/commands/agents-ops.test.ts`:

```ts
it('agents train posts and reports', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/train', method: 'POST' }).reply(200, { data: { status: 'queued' } })
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await AgentsTrain.run(['agt_1'], process.cwd())
    expect(err.mock.calls.join('')).toContain('Training started')
})

it('agents auto-retrain --enabled sends the boolean', async () => {
    let sent = ''
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/auto-retrain', method: 'PUT' })
        .reply(200, function (o) { sent = String(o.body); return { data: { autoRetrain: true } } })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await AgentsAutoRetrain.run(['agt_1', '--enabled'], process.cwd())
    expect(JSON.parse(sent)).toMatchObject({ enabled: true })
})

it('agents styles sends --data JSON', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/styles', method: 'PUT' }).reply(200, { data: {} })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await AgentsStyles.run(['agt_1', '--data', '{"theme":"dark"}'], process.cwd())
})
```

(Adjust the auto-retrain body key to the generated `UpdateAgentAutoRetrainBody` field name — check `src/generated/api.d.ts` when implementing; the generated type is the authority.)

- [ ] **Step 2: Implement** — three ~25-line commands following Task 3's shapes: `train` = positional + POST + `success('Training started for agt_…')`; `auto-retrain` = positional + `--enabled/--disabled` boolean pair mapped to the body; `styles` = positional + required `--data`.

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: agents train/auto-retrain/styles"
```

---

### Task 5: `sources list` / `get` / `summary`

**Files:**
- Create: `src/commands/sources/list.ts`, `src/commands/sources/get.ts`, `src/commands/sources/summary.ts`
- Test: `tests/commands/sources-read.test.ts`

**Interfaces:**
- Consumes: `SourceListItem` fields `id, type, name, size, status, createdAt`; `ListCommand` for list.
- Produces: sources columns (append-only): `id, name, type, status, size`. Status glyphs in pretty mode: `✓` trained/ready, `…` pending/processing, `✗` failed (map unknown → raw text). `sources sync` (Plan 3) consumes `listAllFileSources()` — factor the full-pagination fetch into `src/commands/sources/shared.ts`: `async function listAllSources(client, agentId): Promise<SourceItem[]>` where `type SourceItem = { id: string; type: string; name: string; size: number; status: string }`.

- [ ] **Step 1: Failing tests** — plain row rendering (`src_1\tguide.pdf\tfile\ttrained\t1024`), `--json` envelope passthrough, summary table, `-a` resolution from `CHATBASE_AGENT_ID`. Same MockAgent pattern; endpoints `/api/v2/agents/agt_1/sources`, `/sources/summary`, `/sources/{sourceId}`.

- [ ] **Step 2: Implement** — `list` mirrors `conversations list` exactly (ListCommand, pagination loop via `shared.ts`, hint line); `get` = positional sourceId + `-a`; `summary` = AgentCommand + `GET /sources/summary` printed as a two-column table (metric/value) or raw JSON.

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: sources list/get/summary"
```

---

### Task 6: `sources create` — JSON types + file upload host

**Files:**
- Create: `src/commands/sources/create.ts`, `src/client/files.ts`
- Test: `tests/client/files.test.ts`, `tests/commands/sources-create.test.ts`

**Interfaces:**
- Consumes: `CreateSourceBody` = discriminated union on `type`: `text {name, content}`, `qna {name, questions[]}`, `link {url, linkType, ...}` (JSON, main host). File uploads are a DIFFERENT host and not in the spec: `POST https://files.chatbase.co/api/v2/agents/{agentId}/sources`, multipart fields `name` (string) + `file` (binary); update: `PUT .../sources/{sourceId}` same fields.
- Produces: `src/client/files.ts`: `FILES_BASE_URL = 'https://files.chatbase.co/api/v2'`; `uploadFileSource(opts: { agentId: string; filePath: string; name?: string; apiKey: string; sourceId?: string; baseUrl?: string }): Promise<{ id: string }>` — POST when no `sourceId`, PUT when given. Consumed by Plan 3's sync.

- [ ] **Step 1: Failing tests for the upload client**

`tests/client/files.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uploadFileSource } from '../../src/client/files.js'

it('POSTs multipart name+file and returns the source id', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-up-')), 'guide.pdf')
    fs.writeFileSync(f, 'PDFDATA')
    let contentType = ''
    mock.get('https://files.chatbase.co')
        .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
        .reply(201, function (o) {
            contentType = String(this.headers['content-type'])
            return { data: { id: 'src_new' } }
        })
    const res = await uploadFileSource({ agentId: 'agt_1', filePath: f, apiKey: 'sk' })
    expect(res.id).toBe('src_new')
    expect(contentType).toContain('multipart/form-data')
})

it('PUTs to the sourceId when updating', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-up2-')), 'g.md')
    fs.writeFileSync(f, 'hello')
    mock.get('https://files.chatbase.co')
        .intercept({ path: '/api/v2/agents/agt_1/sources/src_9', method: 'PUT' })
        .reply(200, { data: { id: 'src_9' } })
    const res = await uploadFileSource({ agentId: 'agt_1', filePath: f, apiKey: 'sk', sourceId: 'src_9' })
    expect(res.id).toBe('src_9')
})
```

- [ ] **Step 2: Implement `src/client/files.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { fetch as undiciFetch, getGlobalDispatcher } from 'undici'
import { parseErrorResponse } from '../errors/errors.js'
import { getSigintSignal } from './signals.js'
import { buildUserAgent } from './client.js'

export const FILES_BASE_URL = 'https://files.chatbase.co/api/v2'

export async function uploadFileSource(opts: {
    agentId: string
    filePath: string
    name?: string
    apiKey: string
    sourceId?: string
    baseUrl?: string
}): Promise<{ id: string }> {
    const form = new FormData()
    const buffer = fs.readFileSync(opts.filePath)
    const filename = path.basename(opts.filePath)
    form.set('name', opts.name ?? filename)
    form.set('file', new Blob([buffer]), filename)
    const base = opts.baseUrl ?? FILES_BASE_URL
    const url = opts.sourceId
        ? `${base}/agents/${opts.agentId}/sources/${opts.sourceId}`
        : `${base}/agents/${opts.agentId}/sources`
    const response = await undiciFetch(url, {
        method: opts.sourceId ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'User-Agent': buildUserAgent() },
        body: form,
        dispatcher: getGlobalDispatcher(),
        signal: getSigintSignal()
    })
    const body = (await response.json().catch(() => undefined)) as { data?: { id: string } } | undefined
    if (!response.ok) {
        throw parseErrorResponse(response.status, body, response.headers.get('x-request-id') ?? undefined)
    }
    return { id: body?.data?.id ?? '' }
}
```

- [ ] **Step 3: Failing tests for the command, then implement `sources create`**

Tests: `--type text --name X --content @file` posts JSON to the main host; `--file ./guide.pdf` calls the files host; both print the new id on stdout. Implementation: `AgentCommand`; flags `type (options: ['text','qna','link'])`, `name`, `content` (string or `@file`), `url`, `link-type`, `data` (full JSON via `readBodyData`), `file` (path → delegates to `uploadFileSource` with the resolved api key from `resolveApiKey()`). `--file` and `--type` are mutually exclusive (`exclusive: ['type']`). After create, print `✓ Created source <id> (processing)` on stderr + bare id on stdout + hint `chatbase sources get <id> -a <agent>` .

- [ ] **Step 4: PASS + commit**

```bash
git add -A && git commit -m "feat: sources create (text/qna/link JSON + file upload host)"
```

---

### Task 7: `sources update` / `delete` / `restore`

**Files:**
- Create: `src/commands/sources/update.ts`, `src/commands/sources/delete.ts`, `src/commands/sources/restore.ts`
- Test: `tests/commands/sources-write.test.ts`

**Interfaces:**
- Consumes: `PUT /agents/{agentId}/sources/{sourceId}` (JSON union by type, via `--data`/typed flags; `--file` path re-uploads via `uploadFileSource(sourceId)`); `DELETE .../sources/{sourceId}`; `POST .../sources/{sourceId}/restore`.
- Behavior: `delete` does NOT confirm (spec §4: explicit verb + restorable) — prints `↩ restore with: chatbase sources restore <id> -a <agent>`; `restore` prints success.

- [ ] **Step 1: Failing tests** — delete happy path asserts the restore hint on stderr and NO prompt; restore hits the restore endpoint; update with `--data '{"type":"text","content":"new"}'` PUTs JSON; update with `--file` PUTs multipart to the files host (reuse the Task 6 mock pattern).

- [ ] **Step 2: Implement** — three commands, each ~25 lines following the established AgentCommand + positional sourceId pattern.

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: sources update/delete/restore with restore hint"
```

---

### Task 8: Remaining conversation surface — `conversations get/export`, `messages list/feedback`, `tools submit-result`

**Files:**
- Create: `src/commands/conversations/get.ts`, `src/commands/conversations/export.ts`, `src/commands/messages/list.ts`, `src/commands/messages/feedback.ts`, `src/commands/tools/submit-result.ts`
- Test: `tests/commands/conversations-rest.test.ts`

**Interfaces:**
- Consumes: `GET .../conversations/{conversationId}`; `GET .../conversations/export` (query filters per spec — pass through `--from/--to/--user` if present in generated types, else just pagination); `GET .../conversations/{conversationId}/messages`; `PATCH .../messages/{messageId}/feedback` body `{ feedback: 'positive'|'negative'|null }`; `POST .../tool-result` via `--data`.
- Flag shapes (spec §4 — multi-ID commands use flags): `messages list --conversation <id>`; `messages feedback --conversation <id> --message <id> --rating positive|negative|clear` (clear → `null`); `tools submit-result --conversation <id> --data @result.json`.
- `conversations export`: writes to stdout by default (pipe-friendly), `-o file.json` to save; always `--json`-shaped output (export IS data export; pretty mode = same JSON).

- [ ] **Step 1: Failing tests** — five cases: get renders one conversation row; export streams body to stdout and to `-o` file; messages list renders rows (columns `id, role, createdAt`); feedback maps `--rating clear` → `{"feedback":null}` in the PATCH body; submit-result posts `--data` JSON verbatim.

- [ ] **Step 2: Implement** — five commands. `feedback` example:

```ts
static override flags = {
    ...AgentCommand.baseFlags,
    conversation: Flags.string({ required: true, description: 'Conversation ID' }),
    message: Flags.string({ required: true, description: 'Message ID' }),
    rating: Flags.string({ required: true, options: ['positive', 'negative', 'clear'], description: 'Feedback value' })
}
// body: { feedback: flags.rating === 'clear' ? null : flags.rating }
```

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: conversations get/export, messages list/feedback, tools submit-result"
```

---

### Task 9: Helpdesk — `tickets` topic + `helpdesk teams/statuses`

**Files:**
- Create: `src/commands/tickets/list.ts`, `src/commands/tickets/get.ts`, `src/commands/tickets/create.ts`, `src/commands/tickets/update.ts`, `src/commands/tickets/messages.ts`, `src/commands/tickets/reply.ts`, `src/commands/helpdesk/teams.ts`, `src/commands/helpdesk/statuses.ts`
- Modify: `package.json` (add `tickets` + `helpdesk` topic descriptions)
- Test: `tests/commands/tickets.test.ts`

**Interfaces:**
- Consumes: `Ticket` fields `ticketNumber, subject, statusCategory, channel, teamId, createdAt`; `ListTicketsResponse {data, pagination}`; `CreateTicketBody` (subject/description/customer via `--data` + `--subject` flag); `PATCH tickets/{ticketNumber}`; messages endpoints under `tickets/{ticketNumber}/messages`.
- Produces: tickets columns (append-only): `ticketNumber, subject, statusCategory, channel, createdAt`. `ticketNumber` is an integer positional for `get`/`update`; `messages`/`reply` take `--ticket <n>`.

- [ ] **Step 1: Failing tests** — six cases mirroring the established patterns: list (plain row `42\tRefund broken\topen\temail\t2026-…`), get by number, create with `--subject` + `--data`, update with `--data '{"statusId":"..."}'`, `tickets messages --ticket 42` lists, `tickets reply --ticket 42 -m "On it"` POSTs `{content/text: "On it"}` (field name per generated `CreateTicketMessageBody` — the generated type is the authority).

- [ ] **Step 2: Implement** — eight small commands, all copies of established shapes (ListCommand for `list`; AgentCommand + positional/flags elsewhere). `helpdesk teams`/`statuses` are simple GET + table (columns `id, name`).

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: tickets CRUD + messages/reply, helpdesk teams/statuses"
```

---

### Task 10: `api` escape hatch + `config` + `docs`

**Files:**
- Create: `src/commands/api.ts`, `src/commands/config/get.ts`, `src/commands/config/set.ts`, `src/commands/config/list.ts`, `src/commands/docs.ts`
- Test: `tests/commands/api.test.ts`, `tests/commands/config.test.ts`, `tests/commands/docs.test.ts`

**Interfaces:**
- `api`: `chatbase api <method> <path> [--field k=v ...] [--body @file|@-|json]` — method validated against GET/POST/PUT/PATCH/DELETE; `--field` pairs become query params; body sent as JSON; response JSON printed raw to stdout regardless of mode; exit 1 on non-2xx with the standard error rendering. Extends `rawApiFetch` with a `body`+`query` option (add `opts: { body?: unknown; query?: Record<string, string> }` parameter — modify `src/client/client.ts` accordingly).
- `config`: `get <key>`, `set <key> <value>`, `list`. Keys: `agent`, `timeoutMs`. `set apiKey` is REFUSED with pointer to `auth login` (no secrets via args). `list` prints every effective value **with its source** (flag/env/project/user) using the resolvers.
- `docs`: opens `https://www.chatbase.co/docs/cli` (or a per-command anchor: `chatbase docs sources sync` → `.../docs/cli/sources-sync`) via `open`/`xdg-open`; prints the URL instead when stdout is not a TTY, `--no-input` is set, or spawning fails.

- [ ] **Step 1: Failing tests**

```ts
it('api GET passes query fields and prints raw JSON', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents', method: 'GET', query: { limit: '5' } })
        .reply(200, { data: [] })
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await Api.run(['GET', '/agents', '--field', 'limit=5'], process.cwd())
    expect(JSON.parse(out.mock.calls.join(''))).toEqual({ data: [] })
})

it('config set apiKey is refused', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await expect(ConfigSet.run(['apiKey', 'sk-x'], process.cwd())).rejects.toMatchObject({ oclif: { exit: 2 } })
})

it('config list names each value source', async () => {
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_env')
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await ConfigList.run([], process.cwd())
    expect(err.mock.calls.join('')).toContain('CHATBASE_AGENT_ID')
})

it('docs prints the URL when not a TTY', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    await Docs.run(['sources', 'sync'], process.cwd())
    expect(err.mock.calls.join('')).toContain('https://www.chatbase.co/docs/cli')
})
```

- [ ] **Step 2: Implement** — `api.ts` core:

```ts
static override args = {
    method: Args.string({ required: true, options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }),
    path: Args.string({ required: true, description: 'API path, e.g. /agents' })
}
static override flags = {
    ...BaseCommand.baseFlags,
    field: Flags.string({ multiple: true, description: 'Query param k=v (repeatable)' }),
    body: Flags.string({ description: 'JSON body (@file, @-, or inline)' })
}
// run(): query = Object.fromEntries(flags.field?.map(f => f.split('=', 2)) ?? [])
// res = await rawApiFetch(args.method, args.path, { apiKey, query, body: await readBodyData(flags.body) })
// if res.status >= 400 → throw parseErrorResponse(...); else stdout raw JSON
```

`config` commands use `readUserConfig`/`writeUserConfig` and the resolvers; `docs.ts` builds the anchor from `argv.join('-')` and uses `child_process.spawn('open'|'xdg-open', [url], { detached: true })` guarded by TTY check.

- [ ] **Step 3: PASS + full regression + commit**

```bash
npm run lint && npm test && npm run build && node scripts/check-startup.mjs
git add -A && git commit -m "feat: api escape hatch, config get/set/list, docs command"
```

---

## Self-review

- **Coverage:** all 25 paths / 33 operations now have commands (agents 9, sources 8 incl. files host, conversations 5, messages 2, tools 1, tickets 6, helpdesk 2, health/auth/api/config/docs from Plan 1 + here). Spec §3 command tree fully realized except `chat`/`sync`/`mcp` (Plans 3–4 by design).
- **Placeholders:** Tasks 4, 5, 7, 8, 9 compress repeated command shapes by naming the exact task whose code shape they copy (Task 2/3/6 contain the full reference implementations in this same plan) — acceptable because the reference code is in THIS document; body field names deferred to generated types are explicitly marked "generated type is the authority."
- **Type consistency:** `readBodyData` (Task 3) consumed by Tasks 4, 8, 9, 10; `uploadFileSource` (Task 6) consumed by Task 7 and Plan 3; `listAllSources` (Task 5) consumed by Plan 3. Columns declared append-only per resource.

## Carried forward from Plan 1's final review (deferred with rulings)

Address opportunistically in the tasks that touch these areas:
- `client.ts` spread-order hazard + per-request `signal` discarded — revisit in Task 10 (`api` command introduces caller-supplied request options)
- Unbounded `--all` pagination loop (no page cap) — harden in the ListCommand pattern when stamping out list commands
- `catch()` reads `--json`/`--no-color` via argv sniff — replace with real flag threading if/when oclif exposes parsed flags in catch
- Test gaps (brief-inherited): interactive masked-prompt path, logout rest-preservation, status 200/401 branches, status-fallback remediations, signals.ts child-process test
- `readUserConfig` swallows corrupted-config errors (needs UX decision: warn vs fail)
- `spec-check.sh` /tmp → mktemp (Plan 4 release hardening); npm audit js-yaml transitive (dev-only) — re-check at release

Minor items from the 2026-08-11 pre-merge review (Important findings were fixed on the branch):
- `--json` API errors emit only the raw envelope; spec §7 says errors always surface `x-request-id` — consider adding `requestId` (and `status`) alongside the envelope in `base-command.ts` when Task 10 touches error output
- `client.ts` retry path drops 429/5xx responses without `body.cancel()` — add one line before the retry sleep; also note the `toPlainRequestInit` spread lets a future `requestInitExt.headers` clobber merged Authorization/User-Agent headers (fold into the existing Task 10 spread-order item)
- `conversations-list.test.ts` hygiene: pretty-mode test redefines `process.stdout.isTTY` without restoring; no-agent test passes `'/tmp'` as oclif root believing it sets cwd (passes only while no `chatbase.json` exists above the repo) — fix when stamping out list-command tests
- `auth status` key masking: `slice(-4)` on a key ≤4 chars prints the whole key — only show the tail when length > 8
- CI workflow: add a `permissions:` block and a `concurrency` group before the repo goes public
