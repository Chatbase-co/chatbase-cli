# Chatbase CLI — Plan 4: MCP Server + Release Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **SCOPE CHANGE (2026-08-11, user decision):** the MCP server is DEFERRED
> past v1.0 — "probably no MCP server this time, maybe in the future."
> **Skip Tasks 1–3** (tool defs, server, `mcp` command) and the
> `@modelcontextprotocol/sdk` dependency. Execute Tasks 4–7 only (release
> pipeline, Windows CI, e2e smoke, launch). Tasks 1–3 remain below as the
> ready-made plan for whenever MCP is greenlit; their tool-name interface
> freeze only takes effect if/when they ship. Agent-driven usage in v1 is
> served by the CLI itself (--json, exit codes, uniform help).

**Goal:** `chatbase mcp` — a stdio MCP server exposing every API operation as a typed tool — plus the full release machinery: release-please, npm publish with provenance, auto-generated README reference, Windows CI, and a gated e2e smoke suite. Ends with the CLI ready for its public v1.0.0.

**Architecture:** MCP tools are *derived from the vendored OpenAPI spec at build time* — the same contract that feeds the typed client — via a small builder that walks `spec/openapi.json` operations and emits tool definitions (name, description, JSON-Schema input, annotations). A dispatcher maps tool calls onto `rawApiFetch`. Release automation is configuration on top of Plan 1's CI.

**Tech Stack:** adds `@modelcontextprotocol/sdk` (the only new runtime dependency). release-please + GitHub Actions OIDC for publishing.

**Prerequisites:** Plans 1–3 complete. **Launch gate reminder** (from `docs/launch-checklist.md`): agents + helpdesk endpoints must be customer-released before the repo goes public, or their tools/commands stripped from the launch build; license file decision (MIT pending legal) must land before flipping public.

## Global Constraints (inherited + new)

- All prior constraints. New interface freeze: **MCP tool names and input schemas are public interface** from first release — changes only via deprecation.
- Tool naming: `snake_case` operation names derived as `<verb>_<resource>` (e.g. `list_agents`, `create_source`, `send_message`); the mapping table in Task 1 is the canonical list — review it before it ships, renames later are breaking.
- MCP annotations must be honest: `readOnlyHint: true` for GETs; `destructiveHint: true` for `delete_agent`, `delete_source`; `send_message`/`create_*`/`update_*`/`train_agent` are neither read-only nor destructive.
- The MCP server never prompts — it's headless; confirmation semantics live client-side (Claude asks the user), which is exactly what the annotations inform.

## Consumed interfaces (from Plans 1–3)

- `rawApiFetch(method, path, opts: { apiKey?, query?, body?, baseUrl?, timeoutMs? })` (extended in Plan 2 Task 10), `resolveApiKey()`, `resolveAgent()`, `buildUserAgent()` (gets ` mcp` suffix in Task 2), `parseErrorResponse`, `uploadFileSource`.
- `spec/openapi.json` — 25 paths / 33 operations.

---

### Task 1: MCP tool definitions derived from the spec

**Files:**
- Create: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

**Interfaces:**
- Produces:
  - `type ToolDef = { name: string; description: string; inputSchema: Record<string, unknown>; method: string; pathTemplate: string; annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } }`
  - `buildToolDefs(spec: OpenApiDoc): ToolDef[]` where `OpenApiDoc` is the parsed `spec/openapi.json` (`type OpenApiDoc = { paths: Record<string, Record<string, { summary?: string; description?: string; parameters?: unknown[]; requestBody?: unknown }>> }`)
  - `TOOL_NAME_OVERRIDES: Record<string, string>` — operation → tool-name map for the cases automatic derivation gets wrong; anything not overridden derives as `<method-verb>_<last-meaningful-segment>`.
- Canonical name mapping (the interface freeze — verify all 33 land exactly here):
  `send_message` (POST chat) · `retry_message` (POST retry) · `list_agents` `get_agent` `create_agent` `update_agent` `delete_agent` `clone_agent` `train_agent` `set_agent_auto_retrain` `set_agent_styles` · `list_conversations` `get_conversation` `export_conversations` `list_user_conversations` `list_messages` `update_message_feedback` `submit_tool_result` · `list_sources` `get_source` `create_source` (JSON types only — file upload is CLI-only) `update_source` `delete_source` `restore_source` `get_sources_summary` · `list_tickets` `get_ticket` `create_ticket` `update_ticket` `list_ticket_messages` `create_ticket_message` `list_helpdesk_teams` `list_ticket_statuses` · `health`
- Input schema per tool: object merging path params (from spec `parameters` where `in: 'path'` — `agentId` becomes OPTIONAL in the schema when a default agent is configured at runtime, noted in description), query params (`in: 'query'`), and the `requestBody` JSON schema flattened under a `body` property (or spread when flat). Schemas are taken from the spec verbatim — never hand-written.

- [ ] **Step 1: Failing tests**

```ts
import fs from 'node:fs'
import { buildToolDefs } from '../../src/mcp/tools.js'

const spec = JSON.parse(fs.readFileSync('spec/openapi.json', 'utf8'))
const tools = buildToolDefs(spec)

it('derives one tool per operation with frozen names', () => {
    const names = tools.map((t) => t.name)
    expect(names).toContain('send_message')
    expect(names).toContain('list_agents')
    expect(names).toContain('delete_source')
    expect(names).toHaveLength(Object.values(spec.paths).flatMap((m) => Object.keys(m as object)).length)
    expect(new Set(names).size).toBe(names.length) // no duplicates
})

it('annotates GETs read-only and deletes destructive', () => {
    expect(tools.find((t) => t.name === 'list_agents')?.annotations.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === 'delete_agent')?.annotations.destructiveHint).toBe(true)
    expect(tools.find((t) => t.name === 'send_message')?.annotations.readOnlyHint).toBeUndefined()
})

it('carries path params into the input schema', () => {
    const t = tools.find((t) => t.name === 'get_source')!
    const props = (t.inputSchema as { properties: Record<string, unknown> }).properties
    expect(props).toHaveProperty('agentId')
    expect(props).toHaveProperty('sourceId')
})
```

- [ ] **Step 2: Implement `buildToolDefs`** — walk `spec.paths` × methods; skip nothing; name = `TOOL_NAME_OVERRIDES[`${method} ${path}`] ?? derive(method, path)`; description = operation `summary` + first sentence of `description`; inputSchema = `{ type: 'object', properties: {...params, ...bodyProps}, required: [...] }` assembled from the spec objects (deref `$ref`s against `spec.components.schemas` with a 10-line resolver); annotations from method (`get` → readOnly) + a `DESTRUCTIVE = new Set(['delete_agent', 'delete_source'])`.

- [ ] **Step 3: PASS + commit**

```bash
npx vitest run tests/mcp/tools.test.ts && npm run typecheck
git add -A && git commit -m "feat: MCP tool definitions derived from the OpenAPI spec"
```

---

### Task 2: MCP server + dispatcher

**Files:**
- Create: `src/mcp/server.ts`
- Modify: `src/client/client.ts` (`buildUserAgent(mcp?: boolean)` — appends ` mcp` when true)
- Test: `tests/mcp/server.test.ts`

**Interfaces:**
- Produces: `createMcpServer(opts: { apiKey: string; defaultAgentId?: string }): McpServer` (from `@modelcontextprotocol/sdk/server/mcp.js`) — registers every `ToolDef`; handler resolves the path template from arguments (`{agentId}` falls back to `opts.defaultAgentId`, error if neither), splits remaining args into query (GET/DELETE) vs body (POST/PUT/PATCH), calls `rawApiFetch` with the mcp user agent, returns `{ content: [{ type: 'text', text: JSON.stringify(result.body) }] }`; API errors → `isError: true` with the error envelope text (never a thrown exception — MCP clients handle tool errors, not crashes).
- Dispatch is generic — ONE handler for all 33 tools, driven by `ToolDef.method`/`pathTemplate`.

- [ ] **Step 1: Failing tests** — use the SDK's `InMemoryTransport.createLinkedPair()` + `Client` from `@modelcontextprotocol/sdk` to drive the server in-process:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../../src/mcp/server.js'

async function connected() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer({ apiKey: 'sk-test', defaultAgentId: 'agt_1' })
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientTransport)
    return client
}

it('lists all tools with annotations', async () => {
    const client = await connected()
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThanOrEqual(33)
    expect(tools.find((t) => t.name === 'list_agents')?.annotations?.readOnlyHint).toBe(true)
})

it('calls a tool through to the API using the default agent', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
        .reply(200, { data: [], pagination: { cursor: null, hasMore: false, total: 0 } })
    const client = await connected()
    const res = await client.callTool({ name: 'list_sources', arguments: {} })
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text)).toMatchObject({ data: [] })
})

it('returns isError (not a crash) on API errors', async () => {
    mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
        .reply(401, { error: { code: 'AUTH_INVALID_API_KEY', message: 'bad' } })
    const client = await connected()
    const res = await client.callTool({ name: 'list_sources', arguments: {} })
    expect(res.isError).toBe(true)
})
```

- [ ] **Step 2: Implement** — `npm i @modelcontextprotocol/sdk`; `createMcpServer` loops `buildToolDefs(readSpec())` registering `server.registerTool(name, { description, inputSchema, annotations }, handler(def))`; generic handler as specified. Path template fill: `pathTemplate.replace(/\{(\w+)\}/g, (_, k) => args[k] ?? (k === 'agentId' ? defaultAgentId : missing(k)))`.

- [ ] **Step 3: PASS + commit**

```bash
git add -A && git commit -m "feat: MCP server with generic spec-driven dispatch"
```

---

### Task 3: `mcp` command + `--setup`

**Files:**
- Create: `src/commands/mcp.ts`
- Test: `tests/commands/mcp-setup.test.ts`

**Interfaces:**
- `chatbase mcp` — resolves credentials exactly like every command (`resolveApiKey`; fails with the standard not-authenticated UsageError), builds the server, connects `StdioServerTransport`, stays alive until stdin closes or SIGINT (exits 0). NOTHING may print to stdout except MCP protocol frames — all diagnostics to stderr.
- `chatbase mcp --setup` — prints paste-ready config snippets to stdout (it's the data) for Claude Desktop (`claude_desktop_config.json` path per-OS), Claude Code (`claude mcp add chatbase -- chatbase mcp`), and Cursor; notes the env-var alternative for the key. Never touches any file.

- [ ] **Step 1: Failing test** — `--setup` output contains `"command": "chatbase"`, `"args": ["mcp"]`, the Claude Desktop config path for the current platform, and the `claude mcp add` line.

- [ ] **Step 2: Implement**

```ts
export default class Mcp extends BaseCommand {
    static override description = 'Run an MCP server exposing the Chatbase API as tools'
    static override examples = ['<%= config.bin %> mcp --setup', '<%= config.bin %> mcp']
    static override flags = { ...BaseCommand.baseFlags, setup: Flags.boolean({ description: 'Print client config snippets and exit' }) }

    async run(): Promise<void> {
        const { flags } = await this.parse(Mcp)
        if (flags.setup) {
            process.stdout.write(renderSetupSnippets())
            return
        }
        const resolved = resolveApiKey()
        if (!resolved) throw new UsageError('Not authenticated. Run `chatbase auth login` or set CHATBASE_API_KEY.')
        const server = createMcpServer({ apiKey: resolved.value, defaultAgentId: resolveAgent()?.value })
        const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
        await server.connect(new StdioServerTransport())
        process.stderr.write('chatbase mcp server running (stdio) — Ctrl-C to stop\n')
        await new Promise<void>((resolve) => {
            process.stdin.on('close', resolve)
            process.on('SIGINT', resolve)
        })
    }
}
```

`renderSetupSnippets()` returns the three blocks with per-OS Claude Desktop paths (`~/Library/Application Support/Claude/` on darwin, `%APPDATA%\Claude\` on win32, `~/.config/Claude/` on linux).

- [ ] **Step 3: Manual smoke** (documented): `claude mcp add chatbase-dev -- node <abs>/bin/run.js mcp` then call `list_agents` from Claude Code against a test workspace.

- [ ] **Step 4: PASS + commit**

```bash
git add -A && git commit -m "feat: mcp command with stdio server and --setup snippets"
```

---

### Task 4: Release pipeline — release-please, provenance publish, README automation

**Files:**
- Create: `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`
- Modify: `.github/workflows/ci.yml` (README drift check), `README.md` (regenerated), `package.json` (`repository` field for provenance)

**Interfaces:**
- Produces: merge-to-main → release-please PR → merge → tag `vX.Y.Z` → npm publish with `--provenance` + GitHub Release. README command reference regenerated by `oclif readme` and drift-checked in CI.

- [ ] **Step 1: release-please config**

`release-please-config.json`:

```json
{
    "packages": { ".": { "release-type": "node", "package-name": "chatbase" } },
    "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json"
}
```

`.release-please-manifest.json`: `{ ".": "0.1.0" }`

- [ ] **Step 2: Release workflow**

`.github/workflows/release.yml`:

```yaml
name: Release
on:
    push: { branches: [main] }
permissions:
    contents: write
    pull-requests: write
    id-token: write
jobs:
    release-please:
        runs-on: ubuntu-latest
        outputs:
            release_created: ${{ steps.rp.outputs.release_created }}
        steps:
            - id: rp
              uses: googleapis/release-please-action@v4
    publish:
        needs: release-please
        if: needs.release-please.outputs.release_created == 'true'
        runs-on: ubuntu-latest
        permissions:
            contents: read
            id-token: write
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with: { node-version: 22, registry-url: 'https://registry.npmjs.org' }
            - run: npm ci
            - run: npm test
            - run: npm publish --provenance --access public
              env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
```

(Prefer npm **trusted publishing** — configure the GitHub repo on npmjs.com package settings and drop `NODE_AUTH_TOKEN` entirely; keep the token path documented as fallback. `package.json` must carry `"repository": { "type": "git", "url": "git+https://github.com/Chatbase-co/chatbase-cli.git" }` for provenance to verify.)

- [ ] **Step 3: README automation** — add to `ci.yml` after build: `npx oclif readme && git diff --exit-code README.md` (fails CI when the committed README reference is stale; developers run `npx oclif readme` locally). Regenerate now, review the generated command reference renders correctly, commit.

- [ ] **Step 4: Verify by dry-run** — push a `feat:` commit to a branch, open PR, confirm CI green and release-please opens its PR after merge (on the private repo this is observable end-to-end except the npm publish step, which runs first on the launch release).

```bash
git add -A && git commit -m "chore: release-please + provenance publish pipeline + README drift check"
```

---

### Task 5: Windows CI + platform guards

**Files:**
- Modify: `.github/workflows/ci.yml` (add `windows-latest`), `tests/config/store.test.ts` (0600 guard), any path-separator assumptions found

**Interfaces:**
- Produces: green CI matrix `{ubuntu, macos, windows} × {20, 22}`.

- [ ] **Step 1: Guard the permission assertion** — in `store.test.ts` wrap the `0o600` expectation: `if (process.platform !== 'win32') { ...expect... }` (Windows has no POSIX modes; `writeUserConfig` still works, mode arg is ignored there).
- [ ] **Step 2: Add `windows-latest`** to the CI matrix; push a branch; fix whatever reds appear — the known suspects are hardcoded `/` in path joins (use `path.join` everywhere — audit `config/paths.ts`, `sync/diff.ts` relPath handling: normalize rel paths to `/` separators for source names so sync keys are OS-independent: `relPath.split(path.sep).join('/')`).
- [ ] **Step 3: Startup budget on Windows** — keep the check but set `STARTUP_BUDGET_MS: 2000` for the windows job (its process spawn is slower; the 300 ms product budget is enforced on macOS/Linux).
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "ci: windows matrix with platform guards"
```

---

### Task 6: Gated e2e smoke suite

**Files:**
- Create: `tests/e2e/smoke.e2e.ts`, `.github/workflows/e2e.yml`
- Modify: `vitest.config.ts` (exclude `tests/e2e` from the default run; add `test:e2e` script running only it)

**Interfaces:**
- Runs ONLY when `CHATBASE_E2E_API_KEY` + `CHATBASE_E2E_AGENT_ID` are set (skips otherwise); triggered on release tags + manual dispatch, never on fork PRs (secrets safety).

- [ ] **Step 1: The suite** — five real-API checks against the test workspace:

```ts
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const KEY = process.env.CHATBASE_E2E_API_KEY
const AGENT = process.env.CHATBASE_E2E_AGENT_ID
const run = (args: string[]) =>
    execFileSync('node', ['bin/run.js', ...args], {
        encoding: 'utf8',
        env: { ...process.env, CHATBASE_API_KEY: KEY, CHATBASE_AGENT_ID: AGENT }
    })

describe.skipIf(!KEY || !AGENT)('e2e smoke', () => {
    it('health', () => expect(() => run(['health'])).not.toThrow())
    it('agents list --json returns this agent', () => {
        const res = JSON.parse(run(['agents', 'list', '--json']))
        expect(res.data.some((a: { id: string }) => a.id === AGENT)).toBe(true)
    })
    it('sources list works', () => expect(() => run(['sources', 'list', '--json'])).not.toThrow())
    it('chat one-shot answers', () => {
        const out = run(['chat', '-m', 'Reply with the word pong.', '--no-stream'])
        expect(out.length).toBeGreaterThan(0)
    })
    it('conversations list sees the chat', () => {
        const res = JSON.parse(run(['conversations', 'list', '--json']))
        expect(res.data.length).toBeGreaterThan(0)
    })
})
```

- [ ] **Step 2: Workflow** — `e2e.yml` on `release: { types: [published] }` + `workflow_dispatch`, ubuntu only, `npm ci && npm run build && npm run test:e2e` with the two secrets.
- [ ] **Step 3: Run once manually** (workflow_dispatch) against the test workspace; fix anything real it catches.
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: gated e2e smoke suite on release tags"
```

---

### Task 7 (launch checklist, not code): v1.0.0

- [ ] Work through `docs/launch-checklist.md`: license file committed · SECURITY.md · issue templates · branch protection · second npm owner · `chatbase-co` org · trusted publishing configured · **agents/helpdesk endpoints customer-released (or stripped)** · docs CLI section drafted in the Mintlify repo.
- [ ] Flip the GitHub repo public.
- [ ] Land a `feat!: v1.0.0` release-please commit → merge the release PR → verify npm shows 1.0.0 with provenance badge → `npx chatbase health` from a clean machine.
- [ ] Post-launch (v1.x, separate mini-plans when scheduled): `oclif pack` tarballs + Homebrew tap; pairing-login CLI path once the server ships it; `/me` verification upgrade.

---

## Self-review

- **Coverage vs spec:** §12 MCP (tool-per-operation, spec-derived schemas, honest annotations, stdio lifecycle, `--setup` prints-not-edits, default-agent optionality, ` mcp` User-Agent marker) ✓ · §17 release (release-please, provenance/trusted publishing, README automation, e2e gated on tags, Windows matrix) ✓ · §16 distribution v1 (npm) ✓ with `oclif pack` explicitly deferred to v1.x as the spec says.
- **Placeholders:** none; the two manual smoke steps are labeled as manual and non-CI by design.
- **Type consistency:** `ToolDef`/`buildToolDefs` (Task 1) consumed by Task 2; `createMcpServer` (Task 2) consumed by Task 3; `buildUserAgent(mcp?)` extension matches Plan 1's signature style; `rawApiFetch` options match Plan 2 Task 10's extension.
