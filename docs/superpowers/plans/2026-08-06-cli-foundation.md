# Chatbase CLI — Plan 1: Foundation & Walking Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, installable `chatbase` CLI with the full architectural skeleton (spec-generated typed client, config/credential store, output layer, command base classes) proven by a vertical slice: `health`, `auth login/status/logout`, and `conversations list`.

**Architecture:** oclif (ESM, space topic separator) command layer over an `openapi-fetch` client whose types are generated from a vendored OpenAPI 3.1 spec. All HTTP concerns (auth header, User-Agent, timeout, SIGINT abort, 429/5xx retry, proxy, error envelope parsing) live in `src/client/`; commands only parse flags, call the client, and hand data to `src/output/`. Shared behavior is enforced via `BaseCommand → AgentCommand → ListCommand` inheritance.

**Tech Stack:** TypeScript 5.x, Node ≥ 20, `@oclif/core` v4 (+ plugin-help, plugin-not-found), `openapi-fetch` + `openapi-typescript`, `undici` (fetch + `EnvHttpProxyAgent` + `MockAgent` in tests), `@inquirer/prompts` (masked prompt, lazily imported), Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-08-04-chatbase-cli-design.md` (approved). This plan implements spec §2 (architecture), §4 (flags), §5 (auth v1.0), §6 (config), §7 (output), §9 (errors), §10 (robustness fundamentals), plus the first three command groups. Remaining commands, REPL/sync, MCP, and release pipeline are Plans 2–4.

## Global Constraints (from the spec — every task inherits these)

- Node `>=20`, `"type": "module"` (ESM only). npm package name `chatbase`, binary `chatbase`.
- Data → stdout; progress/hints/errors → stderr. Exit codes: `0` success, `1` API/runtime error, `2` usage error.
- Output modes: pretty (stdout TTY), plain TSV (piped or `--plain`), `--json` = raw API response shape.
- Color palette: red=error, yellow=warning, green=success only. Disabled by: non-TTY stream, `NO_COLOR` (non-empty), `TERM=dumb`, `--no-color`, `CHATBASE_NO_COLOR`; `FORCE_COLOR` (non-empty) overrides all detection.
- Env vars: `CHATBASE_API_KEY`, `CHATBASE_API_KEY_FILE` (wins over `CHATBASE_API_KEY` with a stderr warning), `CHATBASE_AGENT_ID`, `CHATBASE_TIMEOUT` (milliseconds), `CHATBASE_NO_COLOR`.
- Config precedence: flag > env > project `chatbase.json` (walk-up discovery, **never secrets**) > user config `~/.config/chatbase/config.json` (XDG, incl. macOS; written `0600` via temp-file + rename).
- HTTP: 30 000 ms default timeout; auto-retry 429 (all methods, honoring `X-RateLimit-Reset`, max 3 attempts); one retry on 5xx for GET only; `User-Agent: chatbase-cli/<version> (<platform>-<arch>; node/<version>)`; always surface `x-request-id` on errors.
- No secrets via flags. No `.env` loading. No telemetry. Prompts only when stdin is a TTY; `--no-input` forbids prompts.
- Short flags in this plan: `-a` (agent), `-q` (quiet). `-v`/`-d` must not be assigned.
- Style: Biome, 4-space indent, single quotes, semicolons as needed (match main repo).
- Build: `tsc` to `dist/` (per-file output — **deliberate deviation from the spec's "tsup"**: oclif's lazy command loading requires per-file dist; the < 300 ms startup budget is enforced by test instead).
- Commit after every task (repo is initialized in Task 1).

## The vendored spec source

The private repo has a **routes-only OpenAPI generator** (built 2026-08-06:
`scripts/generate-openapi-routes-only.ts` + `scripts/openapi-generator-stubs.ts`
in `../chatbase`) that imports only the pure Zod `*.route.ts` definitions —
bypassing the Next-only import graph that blocks the full `generate:openapi`.
It produces the complete current spec: **25 paths / 33 operations** including
agents CRUD, sources, and helpdesk. Run it with:

```bash
cd ../chatbase && bun --conditions=react-server \
    --preload ./scripts/openapi-generator-stubs.ts \
    scripts/generate-openapi-routes-only.ts
```

Plan 1 vendors this output. `/me` still doesn't exist server-side, so
`auth login` verifies keys via a raw (untyped) `/me` call with graceful 404
fallback, exactly as spec §5 prescribes. The docs-repo copy
(`../docs/api-v2-openapi.json`) is stale (10 paths) — never vendor it.

## File structure (locked in by this plan)

```
chatbase-cli/
├── package.json  tsconfig.json  biome.json  vitest.config.ts  .gitignore
├── bin/run.js                    # oclif ESM entry
├── spec/openapi.json             # vendored spec (committed)
├── scripts/
│   ├── refresh-spec.sh           # copy spec from source + regenerate types
│   ├── spec-check.sh             # CI: fail if api.d.ts drifted from spec
│   └── check-startup.mjs         # CI: cold-start budget
├── src/
│   ├── version.ts                # VERSION constant (from package.json)
│   ├── generated/api.d.ts        # openapi-typescript output (committed)
│   ├── errors/errors.ts          # ApiError, UsageError, envelope parse, remediations
│   ├── config/paths.ts           # XDG dirs
│   ├── config/store.ts           # user config read/atomic write 0600
│   ├── config/project.ts         # chatbase.json walk-up + secret refusal
│   ├── config/resolve.ts         # precedence resolvers (key/agent/timeout)
│   ├── output/color.ts           # color gate + palette
│   ├── output/mode.ts            # pretty/plain/json selection
│   ├── output/render.ts          # renderTable + renderPlain
│   ├── client/signals.ts         # SIGINT AbortSignal singleton
│   ├── client/retry.ts           # retry policy helpers
│   ├── client/client.ts          # createApiClient + rawApiFetch + user agent
│   ├── base/base-command.ts
│   ├── base/agent-command.ts
│   ├── base/list-command.ts
│   └── commands/
│       ├── health.ts
│       ├── auth/{login,logout,status}.ts
│       └── conversations/list.ts
└── tests/                        # mirrors src/ (unit) + commands/ (integration)
```

---

### Task 1: Repo scaffold + runnable oclif skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.gitignore`, `bin/run.js`, `src/version.ts`, `tests/scaffold.test.ts`

**Interfaces:**
- Produces: `VERSION: string` from `src/version.ts`; a building, testable, runnable oclif app with plugins help/not-found; npm scripts `build`, `test`, `lint`, `typecheck`.

- [ ] **Step 1: Initialize git and npm skeleton**

```bash
cd /Users/alyelnaggar/work/chatbase-cli
git init -b main
```

Create `package.json`:

```json
{
    "name": "chatbase",
    "version": "0.1.0",
    "description": "The official command-line interface for the Chatbase API v2",
    "license": "MIT",
    "type": "module",
    "engines": { "node": ">=20" },
    "bin": { "chatbase": "./bin/run.js" },
    "files": ["bin", "dist", "spec", "oclif.manifest.json"],
    "scripts": {
        "build": "rm -rf dist && tsc",
        "typecheck": "tsc --noEmit",
        "lint": "biome check src tests scripts",
        "test": "vitest run",
        "spec:generate": "openapi-typescript spec/openapi.json -o src/generated/api.d.ts",
        "spec:refresh": "bash scripts/refresh-spec.sh",
        "spec:check": "bash scripts/spec-check.sh",
        "prepack": "npm run build && oclif manifest"
    },
    "oclif": {
        "bin": "chatbase",
        "dirname": "chatbase",
        "commands": "./dist/commands",
        "topicSeparator": " ",
        "plugins": ["@oclif/plugin-help", "@oclif/plugin-not-found"],
        "topics": {
            "auth": { "description": "Log in, log out, and inspect credentials" },
            "conversations": { "description": "List and inspect agent conversations" }
        }
    }
}
```

```bash
npm install @oclif/core @oclif/plugin-help @oclif/plugin-not-found openapi-fetch undici
npm install -D typescript @types/node vitest @biomejs/biome openapi-typescript oclif @inquirer/prompts
```

(`@inquirer/prompts` is a devDependency? **No** — move it to dependencies; it ships in `auth login`.)

```bash
npm install @inquirer/prompts
```

- [ ] **Step 2: Create config files**

`tsconfig.json`:

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "outDir": "dist",
        "rootDir": "src",
        "strict": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true
    },
    "include": ["src"]
}
```

`biome.json`:

```json
{
    "formatter": { "indentStyle": "space", "indentWidth": 4 },
    "javascript": {
        "formatter": { "quoteStyle": "single", "semicolons": "asNeeded", "trailingCommas": "none" }
    },
    "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        restoreMocks: true,
        unstubEnvs: true
    }
})
```

`.gitignore`:

```
node_modules/
dist/
oclif.manifest.json
coverage/
*.tsbuildinfo
```

`bin/run.js`:

```js
#!/usr/bin/env node
import { execute } from '@oclif/core'

await execute({ dir: import.meta.url })
```

```bash
chmod +x bin/run.js
```

`src/version.ts`:

```ts
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const VERSION: string = require('../package.json').version
```

- [ ] **Step 3: Write the failing scaffold test**

`tests/scaffold.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('scaffold', () => {
    it('runs --version and prints the package version', () => {
        const out = execFileSync('node', ['bin/run.js', '--version'], { encoding: 'utf8' })
        expect(out).toContain('chatbase/0.1.0')
    })

    it('bare invocation shows help and does NOT default into a subcommand', () => {
        const out = execFileSync('node', ['bin/run.js'], { encoding: 'utf8' })
        expect(out).toMatch(/USAGE|COMMANDS|TOPICS/)
    })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/scaffold.test.ts`
Expected: FAIL — `dist/` doesn't exist yet, oclif can't load commands.

- [ ] **Step 5: Build and re-run**

Run: `npm run build && npx vitest run tests/scaffold.test.ts`
Expected: PASS (oclif with zero commands still serves `--version` and help). If help exits non-zero with no commands, create `src/commands/.gitkeep` placeholder dir — the real commands arrive in Tasks 8–10; adjust only if needed.

- [ ] **Step 6: Lint, then commit**

```bash
npx biome check --write src tests
git add -A
git commit -m "chore: scaffold oclif ESM CLI (chatbase) with vitest + biome"
```

---

### Task 2: Vendor the OpenAPI spec + generate types

**Files:**
- Create: `spec/openapi.json`, `scripts/refresh-spec.sh`, `scripts/spec-check.sh`, `src/generated/api.d.ts` (generated), `tests/generated/types.test.ts`

**Interfaces:**
- Produces: `import type { paths } from '../generated/api.js'` — typed paths for `/health` and `/agents/{agentId}/conversations` (+ 8 more). Consumed by Task 6 (client) and Tasks 8/10 (commands).

- [ ] **Step 1: Create the refresh script**

`scripts/refresh-spec.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Refresh the vendored OpenAPI spec, then regenerate TypeScript types.
#
# Source resolution:
#   $1 if given, else the docs-repo copy (currently the only runnable source:
#   the private repo generator (npm run generate:openapi in ../chatbase)
#   cannot run standalone yet — it imports Next-only modules. Once the
#   private repo ships its routes-only generator, pass its output here.)
SRC="${1:-}"
if [ -z "$SRC" ]; then
    # Default: regenerate from the sibling private checkout (routes-only generator).
    (cd ../chatbase && bun --conditions=react-server \
        --preload ./scripts/openapi-generator-stubs.ts \
        scripts/generate-openapi-routes-only.ts >/dev/null)
    SRC=../chatbase/openapi.json
fi
if [ ! -f "$SRC" ]; then
    echo "spec source not found: $SRC" >&2
    exit 1
fi
cp "$SRC" spec/openapi.json
npm run spec:generate
echo "vendored $(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('spec/openapi.json')).paths).length)") paths"
```

`scripts/spec-check.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# CI guard: src/generated/api.d.ts must exactly match spec/openapi.json.
npx openapi-typescript spec/openapi.json -o /tmp/api-check.d.ts >/dev/null
if ! diff -q /tmp/api-check.d.ts src/generated/api.d.ts >/dev/null; then
    echo "src/generated/api.d.ts is out of sync with spec/openapi.json." >&2
    echo "Run: npm run spec:generate" >&2
    exit 1
fi
```

```bash
chmod +x scripts/refresh-spec.sh scripts/spec-check.sh
bash scripts/refresh-spec.sh
```

Expected: `vendored 25 paths` and `src/generated/api.d.ts` created.

- [ ] **Step 2: Write the failing type-assertion test**

`tests/generated/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { paths } from '../../src/generated/api.js'

// Compile-time assertions: if the spec loses these paths or shapes, tsc fails.
type HealthOp = paths['/health']['get']
type ListConvsOp = paths['/agents/{agentId}/conversations']['get']
type ListSourcesOp = paths['/agents/{agentId}/sources']['get']
type ListAgentsOp = paths['/agents']['get']

const healthHas200: HealthOp extends { responses: { 200: unknown } } ? true : false = true
const listTakesCursor: NonNullable<
    NonNullable<ListConvsOp['parameters']['query']>
> extends { cursor?: unknown } ? true : false = true
const sourcesPresent: ListSourcesOp extends { responses: { 200: unknown } } ? true : false = true
const agentsPresent: ListAgentsOp extends { responses: { 200: unknown } } ? true : false = true

describe('generated types', () => {
    it('cover the endpoints this plan builds on', () => {
        expect(healthHas200).toBe(true)
        expect(listTakesCursor).toBe(true)
        expect(sourcesPresent).toBe(true)
        expect(agentsPresent).toBe(true)
    })
})
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npx vitest run tests/generated/types.test.ts && npm run typecheck`
Expected: PASS. (If `typecheck` complains that `src/generated/api.d.ts` has lint issues, add `spec/` and `src/generated/` to a `biome.json` ignore list — generated artifacts are exempt from style.)

- [ ] **Step 4: Verify spec:check catches drift**

Run: `echo '// drift' >> src/generated/api.d.ts && bash scripts/spec-check.sh; echo "exit=$?"`
Expected: `exit=1`. Then restore: `npm run spec:generate && bash scripts/spec-check.sh`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: vendor OpenAPI spec and generate typed client definitions"
```

---

### Task 3: Error model — ApiError, envelope parsing, remediations

**Files:**
- Create: `src/errors/errors.ts`
- Test: `tests/errors/errors.test.ts`

**Interfaces:**
- Produces:
  - `class UsageError extends Error` (→ exit 2)
  - `class ApiError extends Error { code: string; status: number; requestId?: string; details?: unknown; remediation?: string }`
  - `parseErrorResponse(status: number, body: unknown, requestId?: string): ApiError`
  - `formatApiError(err: ApiError, color: { red(s: string): string; dim(s: string): string }): string`
- Consumed by: client (Task 6), BaseCommand.catch (Task 7).

- [ ] **Step 1: Write the failing tests**

`tests/errors/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ApiError, formatApiError, parseErrorResponse } from '../../src/errors/errors.js'

const noColor = { red: (s: string) => s, dim: (s: string) => s }

describe('parseErrorResponse', () => {
    it('parses the API v2 error envelope', () => {
        const err = parseErrorResponse(
            401,
            { error: { code: 'AUTH_MISSING_API_KEY', message: 'Authentication required' } },
            'req_123'
        )
        expect(err).toBeInstanceOf(ApiError)
        expect(err.code).toBe('AUTH_MISSING_API_KEY')
        expect(err.status).toBe(401)
        expect(err.requestId).toBe('req_123')
        expect(err.remediation).toContain('chatbase auth login')
    })

    it('keeps field-level details for validation errors', () => {
        const err = parseErrorResponse(400, {
            error: { code: 'VALIDATION_INVALID_BODY', message: 'Invalid request', details: { name: 'required' } }
        })
        expect(err.details).toEqual({ name: 'required' })
    })

    it('falls back to status-based codes for non-envelope bodies', () => {
        const err = parseErrorResponse(502, 'Bad Gateway')
        expect(err.code).toBe('HTTP_502')
        expect(err.message).toContain('502')
    })
})

describe('formatApiError', () => {
    it('puts remediation last and includes the request id', () => {
        const err = parseErrorResponse(
            401,
            { error: { code: 'AUTH_INVALID_API_KEY', message: 'Invalid API key' } },
            'req_9'
        )
        const out = formatApiError(err, noColor)
        expect(out).toContain('✗ Invalid API key (AUTH_INVALID_API_KEY)')
        expect(out).toContain('request id: req_9')
        expect(out.trim().split('\n').at(-1)).toMatch(/auth login|CHATBASE_API_KEY/)
    })

    it('lists validation details one field per line', () => {
        const err = parseErrorResponse(400, {
            error: {
                code: 'VALIDATION_INVALID_BODY',
                message: 'Invalid request',
                details: { name: 'required', url: 'must be a valid URL' }
            }
        })
        const out = formatApiError(err, noColor)
        expect(out).toContain('name  required')
        expect(out).toContain('url  must be a valid URL')
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/errors`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/errors/errors.ts`:

```ts
export class UsageError extends Error {}

export class ApiError extends Error {
    code: string
    status: number
    requestId?: string
    details?: unknown
    remediation?: string

    constructor(opts: {
        code: string
        message: string
        status: number
        requestId?: string
        details?: unknown
        remediation?: string
    }) {
        super(opts.message)
        this.code = opts.code
        this.status = opts.status
        this.requestId = opts.requestId
        this.details = opts.details
        this.remediation = opts.remediation
    }
}

const REMEDIATIONS: Record<string, string> = {
    AUTH_MISSING_API_KEY:
        'Run `chatbase auth login`, or set CHATBASE_API_KEY. Keys live in chatbase.co → Workspace Settings → API Keys.',
    AUTH_INVALID_API_KEY:
        'Your key was rejected. Run `chatbase auth login` with a fresh key, or check CHATBASE_API_KEY.',
    VALIDATION_INVALID_BODY: 'Fix the fields above and retry.'
}

const STATUS_REMEDIATIONS: Record<number, string> = {
    403: 'API access requires the Standard plan or higher — upgrade at chatbase.co.',
    404: 'Resource not found — check the ID (agent IDs live in your dashboard).',
    429: 'Rate limited — the CLI already retried; wait for the reset and try again.'
}

type Envelope = { error: { code: string; message: string; details?: unknown } }

function isEnvelope(body: unknown): body is Envelope {
    return (
        typeof body === 'object' &&
        body !== null &&
        typeof (body as Envelope).error === 'object' &&
        typeof (body as Envelope).error?.code === 'string'
    )
}

export function parseErrorResponse(status: number, body: unknown, requestId?: string): ApiError {
    if (isEnvelope(body)) {
        const { code, message, details } = body.error
        return new ApiError({
            code,
            message,
            status,
            requestId,
            details,
            remediation: REMEDIATIONS[code] ?? STATUS_REMEDIATIONS[status]
        })
    }
    return new ApiError({
        code: `HTTP_${status}`,
        message: `Request failed with status ${status}`,
        status,
        requestId,
        remediation: STATUS_REMEDIATIONS[status]
    })
}

export function formatApiError(
    err: ApiError,
    color: { red(s: string): string; dim(s: string): string }
): string {
    const lines: string[] = [color.red(`✗ ${err.message} (${err.code})`)]
    if (err.details && typeof err.details === 'object') {
        for (const [field, problem] of Object.entries(err.details as Record<string, unknown>)) {
            lines.push(`    ${field}  ${String(problem)}`)
        }
    }
    if (err.requestId) lines.push(color.dim(`  request id: ${err.requestId}`))
    if (err.remediation) lines.push(`  ${err.remediation}`)
    return lines.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/errors && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: API error model with envelope parsing and remediations"
```

---

### Task 4: Config — XDG paths, atomic store, project file, precedence

**Files:**
- Create: `src/config/paths.ts`, `src/config/store.ts`, `src/config/project.ts`, `src/config/resolve.ts`
- Test: `tests/config/store.test.ts`, `tests/config/project.test.ts`, `tests/config/resolve.test.ts`

**Interfaces:**
- Produces:
  - `paths.ts`: `configDir(): string`, `configFile(): string`, `stateDir(): string`, `logsDir(): string`, `cacheDir(): string` (all honor `XDG_*` env overrides)
  - `store.ts`: `type UserConfig = { apiKey?: string; agent?: string; timeoutMs?: number }`, `readUserConfig(): UserConfig`, `writeUserConfig(c: UserConfig): void`
  - `project.ts`: `type ProjectConfig = { agent?: string; path: string }`, `findProjectConfig(startDir?: string): ProjectConfig | undefined` (throws `UsageError` if the file contains secret-like keys)
  - `resolve.ts`: `type Resolved = { value: string; source: string; warning?: string }`, `resolveApiKey(): Resolved | undefined`, `resolveAgent(flag?: string, cwd?: string): Resolved | undefined`, `resolveTimeoutMs(): number`
- Consumed by: client factory, BaseCommand, auth commands.

- [ ] **Step 1: Write the failing tests**

`tests/config/store.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

function withTempConfigHome() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'))
    vi.stubEnv('XDG_CONFIG_HOME', dir)
    return dir
}

describe('user config store', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('round-trips config and writes with 0600 permissions', async () => {
        const dir = withTempConfigHome()
        const { readUserConfig, writeUserConfig } = await import('../../src/config/store.js')
        writeUserConfig({ apiKey: 'sk-test', agent: 'agt_1' })
        expect(readUserConfig()).toEqual({ apiKey: 'sk-test', agent: 'agt_1' })
        const file = path.join(dir, 'chatbase', 'config.json')
        const mode = fs.statSync(file).mode & 0o777
        expect(mode).toBe(0o600)
    })

    it('returns {} when no config exists', async () => {
        withTempConfigHome()
        const { readUserConfig } = await import('../../src/config/store.js')
        expect(readUserConfig()).toEqual({})
    })

    it('leaves no temp files behind (atomic write)', async () => {
        const dir = withTempConfigHome()
        const { writeUserConfig } = await import('../../src/config/store.js')
        writeUserConfig({ agent: 'x' })
        const files = fs.readdirSync(path.join(dir, 'chatbase'))
        expect(files).toEqual(['config.json'])
    })
})
```

`tests/config/project.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findProjectConfig } from '../../src/config/project.js'
import { UsageError } from '../../src/errors/errors.js'

function tempProject(json: unknown, nest = 'a/b') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-proj-'))
    fs.writeFileSync(path.join(root, 'chatbase.json'), JSON.stringify(json))
    const deep = path.join(root, nest)
    fs.mkdirSync(deep, { recursive: true })
    return { root, deep }
}

describe('findProjectConfig', () => {
    it('walks up from nested directories', () => {
        const { root, deep } = tempProject({ agent: 'agt_proj' })
        const found = findProjectConfig(deep)
        expect(found?.agent).toBe('agt_proj')
        expect(found?.path).toBe(path.join(root, 'chatbase.json'))
    })

    it('returns undefined when there is no chatbase.json', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-none-'))
        expect(findProjectConfig(dir)).toBeUndefined()
    })

    it('refuses to run when the project file contains secret-like keys', () => {
        const { deep } = tempProject({ agent: 'x', apiKey: 'sk-oops' })
        expect(() => findProjectConfig(deep)).toThrow(UsageError)
        expect(() => findProjectConfig(deep)).toThrow(/never store secrets/i)
    })
})
```

`tests/config/resolve.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAgent, resolveApiKey, resolveTimeoutMs } from '../../src/config/resolve.js'

describe('resolveApiKey', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('CHATBASE_API_KEY_FILE beats CHATBASE_API_KEY, with a warning', () => {
        const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-key-')), 'key')
        fs.writeFileSync(f, 'sk-from-file\n')
        vi.stubEnv('CHATBASE_API_KEY_FILE', f)
        vi.stubEnv('CHATBASE_API_KEY', 'sk-from-env')
        const r = resolveApiKey()
        expect(r?.value).toBe('sk-from-file')
        expect(r?.source).toBe('CHATBASE_API_KEY_FILE')
        expect(r?.warning).toMatch(/both/i)
    })

    it('falls back to CHATBASE_API_KEY, then user config, else undefined', () => {
        vi.stubEnv('XDG_CONFIG_HOME', fs.mkdtempSync(path.join(os.tmpdir(), 'cb-x-')))
        vi.stubEnv('CHATBASE_API_KEY', 'sk-env')
        expect(resolveApiKey()?.source).toBe('CHATBASE_API_KEY')
        vi.stubEnv('CHATBASE_API_KEY', '')
        expect(resolveApiKey()).toBeUndefined()
    })
})

describe('resolveAgent precedence: flag > env > project > user config', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('flag wins over everything', () => {
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_env')
        expect(resolveAgent('agt_flag')?.value).toBe('agt_flag')
        expect(resolveAgent('agt_flag')?.source).toBe('flag')
    })

    it('env beats project config', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-r-'))
        fs.writeFileSync(path.join(root, 'chatbase.json'), JSON.stringify({ agent: 'agt_proj' }))
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_env')
        expect(resolveAgent(undefined, root)?.value).toBe('agt_env')
        vi.stubEnv('CHATBASE_AGENT_ID', '')
        const r = resolveAgent(undefined, root)
        expect(r?.value).toBe('agt_proj')
        expect(r?.source).toContain('chatbase.json')
    })
})

describe('resolveTimeoutMs', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('defaults to 30000 and honors CHATBASE_TIMEOUT', () => {
        expect(resolveTimeoutMs()).toBe(30000)
        vi.stubEnv('CHATBASE_TIMEOUT', '5000')
        expect(resolveTimeoutMs()).toBe(5000)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four modules**

`src/config/paths.ts`:

```ts
import os from 'node:os'
import path from 'node:path'

function xdg(envVar: string, fallback: string): string {
    const v = process.env[envVar]
    return v && v.length > 0 ? v : path.join(os.homedir(), fallback)
}

export const configDir = () => path.join(xdg('XDG_CONFIG_HOME', '.config'), 'chatbase')
export const configFile = () => path.join(configDir(), 'config.json')
export const stateDir = () => path.join(xdg('XDG_STATE_HOME', '.local/state'), 'chatbase')
export const logsDir = () => path.join(stateDir(), 'logs')
export const cacheDir = () => path.join(xdg('XDG_CACHE_HOME', '.cache'), 'chatbase')
```

`src/config/store.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { configDir, configFile } from './paths.js'

export type UserConfig = {
    apiKey?: string
    agent?: string
    timeoutMs?: number
}

export function readUserConfig(): UserConfig {
    try {
        return JSON.parse(fs.readFileSync(configFile(), 'utf8')) as UserConfig
    } catch {
        return {}
    }
}

export function writeUserConfig(config: UserConfig): void {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 })
    const tmp = path.join(configDir(), `.config.json.tmp-${process.pid}`)
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(tmp, configFile())
}
```

`src/config/project.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { UsageError } from '../errors/errors.js'

export type ProjectConfig = {
    agent?: string
    path: string
}

const SECRET_KEYS = ['apikey', 'api_key', 'apikeyfile', 'key', 'token', 'secret']

export function findProjectConfig(startDir: string = process.cwd()): ProjectConfig | undefined {
    let dir = path.resolve(startDir)
    for (;;) {
        const candidate = path.join(dir, 'chatbase.json')
        if (fs.existsSync(candidate)) {
            const raw = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<string, unknown>
            const offending = Object.keys(raw).find((k) => SECRET_KEYS.includes(k.toLowerCase()))
            if (offending) {
                throw new UsageError(
                    `${candidate} contains "${offending}" — never store secrets in project config. ` +
                        'chatbase.json is designed to be committed; use `chatbase auth login` or CHATBASE_API_KEY instead.'
                )
            }
            return { agent: typeof raw.agent === 'string' ? raw.agent : undefined, path: candidate }
        }
        const parent = path.dirname(dir)
        if (parent === dir) return undefined
        dir = parent
    }
}
```

`src/config/resolve.ts`:

```ts
import fs from 'node:fs'
import { findProjectConfig } from './project.js'
import { readUserConfig } from './store.js'

export type Resolved = {
    value: string
    source: string
    warning?: string
}

export function resolveApiKey(): Resolved | undefined {
    const file = process.env.CHATBASE_API_KEY_FILE
    const env = process.env.CHATBASE_API_KEY
    if (file && file.length > 0) {
        const value = fs.readFileSync(file, 'utf8').trim()
        return {
            value,
            source: 'CHATBASE_API_KEY_FILE',
            warning:
                env && env.length > 0
                    ? 'Both CHATBASE_API_KEY_FILE and CHATBASE_API_KEY are set; using the file.'
                    : undefined
        }
    }
    if (env && env.length > 0) return { value: env, source: 'CHATBASE_API_KEY' }
    const stored = readUserConfig().apiKey
    if (stored) return { value: stored, source: 'user config' }
    return undefined
}

export function resolveAgent(flag?: string, cwd?: string): Resolved | undefined {
    if (flag) return { value: flag, source: 'flag' }
    const env = process.env.CHATBASE_AGENT_ID
    if (env && env.length > 0) return { value: env, source: 'CHATBASE_AGENT_ID' }
    const project = findProjectConfig(cwd)
    if (project?.agent) return { value: project.agent, source: project.path }
    const stored = readUserConfig().agent
    if (stored) return { value: stored, source: 'user config' }
    return undefined
}

export function resolveTimeoutMs(): number {
    const env = process.env.CHATBASE_TIMEOUT
    if (env && /^\d+$/.test(env)) return Number(env)
    return readUserConfig().timeoutMs ?? 30000
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config && npm run typecheck`
Expected: PASS. (Note: the 0600-permission assertion is skipped-on-Windows territory — if CI later fails there, wrap that one `expect` in `if (process.platform !== 'win32')`.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: config layer — XDG paths, atomic 0600 store, project file, precedence"
```

---

### Task 5: Output layer — mode selection, color gate, renderers

**Files:**
- Create: `src/output/color.ts`, `src/output/mode.ts`, `src/output/render.ts`
- Test: `tests/output/output.test.ts`

**Interfaces:**
- Produces:
  - `color.ts`: `colorEnabled(stream: { isTTY?: boolean }, noColorFlag?: boolean): boolean`; `paint(enabled: boolean): Palette` where `type Palette = { red(s: string): string; green(s: string): string; yellow(s: string): string; dim(s: string): string }`
  - `mode.ts`: `type OutputMode = 'pretty' | 'plain' | 'json'`; `selectMode(flags: { json?: boolean; plain?: boolean }, stream?: { isTTY?: boolean }): OutputMode`
  - `render.ts`: `type Column = { key: string; header: string }`; `renderTable(rows: Record<string, string>[], columns: Column[]): string`; `renderPlain(rows: Record<string, string>[], columns: Column[]): string`
- Consumed by: BaseCommand (Task 7) and all commands.

- [ ] **Step 1: Write the failing tests**

`tests/output/output.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { colorEnabled } from '../../src/output/color.js'
import { selectMode } from '../../src/output/mode.js'
import { renderPlain, renderTable } from '../../src/output/render.js'

describe('selectMode', () => {
    it('json flag wins, then plain flag, then TTY detection', () => {
        expect(selectMode({ json: true, plain: true }, { isTTY: true })).toBe('json')
        expect(selectMode({ plain: true }, { isTTY: true })).toBe('plain')
        expect(selectMode({}, { isTTY: true })).toBe('pretty')
        expect(selectMode({}, { isTTY: false })).toBe('plain')
    })
})

describe('colorEnabled', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('FORCE_COLOR overrides everything', () => {
        vi.stubEnv('FORCE_COLOR', '1')
        vi.stubEnv('NO_COLOR', '1')
        expect(colorEnabled({ isTTY: false })).toBe(true)
    })

    it('disabled by --no-color, NO_COLOR, CHATBASE_NO_COLOR, TERM=dumb, non-TTY', () => {
        expect(colorEnabled({ isTTY: true }, true)).toBe(false)
        vi.stubEnv('NO_COLOR', '1')
        expect(colorEnabled({ isTTY: true })).toBe(false)
        vi.unstubAllEnvs()
        vi.stubEnv('CHATBASE_NO_COLOR', '1')
        expect(colorEnabled({ isTTY: true })).toBe(false)
        vi.unstubAllEnvs()
        vi.stubEnv('TERM', 'dumb')
        expect(colorEnabled({ isTTY: true })).toBe(false)
        vi.unstubAllEnvs()
        expect(colorEnabled({ isTTY: false })).toBe(false)
        expect(colorEnabled({ isTTY: true })).toBe(true)
    })
})

const rows = [
    { id: 'c_1', title: 'Refund question', status: 'open' },
    { id: 'c_22', title: 'Hi', status: 'closed' }
]
const columns = [
    { key: 'id', header: 'ID' },
    { key: 'title', header: 'TITLE' },
    { key: 'status', header: 'STATUS' }
]

describe('renderers', () => {
    it('renderTable aligns columns under headers', () => {
        const out = renderTable(rows, columns)
        const lines = out.split('\n')
        expect(lines[0]).toMatch(/^ID\s+TITLE\s+STATUS$/)
        expect(lines[1].indexOf('Refund')).toBe(lines[0].indexOf('TITLE'))
    })

    it('renderPlain emits one tab-separated record per line, no header', () => {
        const out = renderPlain(rows, columns)
        expect(out.split('\n')).toEqual(['c_1\tRefund question\topen', 'c_22\tHi\tclosed'])
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/output`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/output/color.ts`:

```ts
export type Palette = {
    red(s: string): string
    green(s: string): string
    yellow(s: string): string
    dim(s: string): string
}

export function colorEnabled(stream: { isTTY?: boolean }, noColorFlag = false): boolean {
    const force = process.env.FORCE_COLOR
    if (force && force.length > 0 && force !== '0') return true
    if (noColorFlag) return false
    const no = process.env.NO_COLOR
    if (no && no.length > 0) return false
    const cbNo = process.env.CHATBASE_NO_COLOR
    if (cbNo && cbNo.length > 0) return false
    if (process.env.TERM === 'dumb') return false
    return stream.isTTY === true
}

const wrap = (open: string) => (s: string) => `[${open}m${s}[0m`
const identity = (s: string) => s

export function paint(enabled: boolean): Palette {
    if (!enabled) return { red: identity, green: identity, yellow: identity, dim: identity }
    return { red: wrap('31'), green: wrap('32'), yellow: wrap('33'), dim: wrap('2') }
}
```

`src/output/mode.ts`:

```ts
export type OutputMode = 'pretty' | 'plain' | 'json'

export function selectMode(
    flags: { json?: boolean; plain?: boolean },
    stream: { isTTY?: boolean } = process.stdout
): OutputMode {
    if (flags.json) return 'json'
    if (flags.plain) return 'plain'
    return stream.isTTY ? 'pretty' : 'plain'
}
```

`src/output/render.ts`:

```ts
export type Column = { key: string; header: string }

export function renderTable(rows: Record<string, string>[], columns: Column[]): string {
    const widths = columns.map((c) =>
        Math.max(c.header.length, ...rows.map((r) => (r[c.key] ?? '').length))
    )
    const line = (cells: string[]) =>
        cells
            .map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i] + 2)))
            .join('')
            .trimEnd()
    return [line(columns.map((c) => c.header)), ...rows.map((r) => line(columns.map((c) => r[c.key] ?? '')))].join(
        '\n'
    )
}

export function renderPlain(rows: Record<string, string>[], columns: Column[]): string {
    return rows.map((r) => columns.map((c) => r[c.key] ?? '').join('\t')).join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/output && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: output layer — mode selection, color gate, table/TSV renderers"
```

---

### Task 6: HTTP client — typed openapi-fetch factory with retry, timeout, SIGINT, proxy

**Files:**
- Create: `src/client/signals.ts`, `src/client/retry.ts`, `src/client/client.ts`
- Test: `tests/client/retry.test.ts`, `tests/client/client.test.ts`

**Interfaces:**
- Consumes: `paths` (Task 2), `parseErrorResponse` (Task 3), `resolveTimeoutMs` (Task 4).
- Produces:
  - `signals.ts`: `getSigintSignal(): AbortSignal`, `installSigintHandler(): void` (first ^C: abort + `Interrupted` on stderr; second ^C: `process.exit(130)`; 2 s force-exit timer, `unref`ed)
  - `retry.ts`: `computeRetryDelayMs(attempt: number, resetHeader: string | null, nowMs: number): number`, `shouldRetry(status: number, method: string, attempt: number): boolean`
  - `client.ts`: `type ApiClientOptions = { apiKey?: string; timeoutMs?: number; baseUrl?: string }`; `createApiClient(opts?: ApiClientOptions): Client<paths>` (from `openapi-fetch`); `buildUserAgent(): string`; `rawApiFetch(method: string, path: string, opts?: ApiClientOptions): Promise<{ status: number; requestId?: string; body: unknown }>`; `DEFAULT_BASE_URL = 'https://www.chatbase.co/api/v2'`; `throwIfError(response: Response, body: unknown): void` (throws `ApiError` via `parseErrorResponse`)
- Test seam: undici `MockAgent` via `setGlobalDispatcher` (the client uses the global dispatcher unless proxy env vars are set, in which case it constructs an `EnvHttpProxyAgent`).

- [ ] **Step 1: Write the failing retry-policy tests**

`tests/client/retry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeRetryDelayMs, shouldRetry } from '../../src/client/retry.js'

describe('shouldRetry', () => {
    it('retries 429 for any method up to 3 attempts', () => {
        expect(shouldRetry(429, 'POST', 1)).toBe(true)
        expect(shouldRetry(429, 'GET', 3)).toBe(true)
        expect(shouldRetry(429, 'GET', 4)).toBe(false)
    })

    it('retries 5xx once, GET only', () => {
        expect(shouldRetry(502, 'GET', 1)).toBe(true)
        expect(shouldRetry(502, 'GET', 2)).toBe(false)
        expect(shouldRetry(502, 'POST', 1)).toBe(false)
    })

    it('never retries 4xx other than 429', () => {
        expect(shouldRetry(400, 'GET', 1)).toBe(false)
        expect(shouldRetry(404, 'GET', 1)).toBe(false)
    })
})

describe('computeRetryDelayMs', () => {
    it('uses X-RateLimit-Reset (unix ms) when present, capped at 60s', () => {
        const now = 1_700_000_000_000
        expect(computeRetryDelayMs(1, String(now + 5000), now)).toBe(5000)
        expect(computeRetryDelayMs(1, String(now + 500_000), now)).toBe(60_000)
        expect(computeRetryDelayMs(1, String(now - 1000), now)).toBeGreaterThan(0)
    })

    it('falls back to exponential backoff without the header', () => {
        const d1 = computeRetryDelayMs(1, null, 0)
        const d2 = computeRetryDelayMs(2, null, 0)
        expect(d1).toBeGreaterThanOrEqual(500)
        expect(d2).toBeGreaterThan(d1)
    })
})
```

- [ ] **Step 2: Run to verify failure, implement retry.ts + signals.ts**

Run: `npx vitest run tests/client/retry.test.ts` → FAIL.

`src/client/retry.ts`:

```ts
export function shouldRetry(status: number, method: string, attempt: number): boolean {
    if (status === 429) return attempt <= 3
    if (status >= 500 && method.toUpperCase() === 'GET') return attempt <= 1
    return false
}

export function computeRetryDelayMs(attempt: number, resetHeader: string | null, nowMs: number): number {
    if (resetHeader && /^\d+$/.test(resetHeader)) {
        const wait = Number(resetHeader) - nowMs
        if (wait > 0) return Math.min(wait, 60_000)
    }
    const base = 500 * 2 ** (attempt - 1)
    return base + Math.floor(Math.random() * 250)
}
```

`src/client/signals.ts`:

```ts
const controller = new AbortController()
let interrupts = 0
let installed = false

export function getSigintSignal(): AbortSignal {
    return controller.signal
}

export function installSigintHandler(): void {
    if (installed) return
    installed = true
    process.on('SIGINT', () => {
        interrupts += 1
        if (interrupts === 1) {
            process.stderr.write('\nInterrupted\n')
            controller.abort()
            // Hard cap: if graceful teardown hangs, force-exit in 2s.
            setTimeout(() => process.exit(130), 2000).unref()
        } else {
            process.exit(130)
        }
    })
}
```

Run: `npx vitest run tests/client/retry.test.ts` → PASS.

- [ ] **Step 3: Write the failing client integration tests**

`tests/client/client.test.ts`:

```ts
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildUserAgent, createApiClient, rawApiFetch } from '../../src/client/client.js'
import { ApiError } from '../../src/errors/errors.js'
import { VERSION } from '../../src/version.js'

const BASE = 'https://www.chatbase.co'

let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
})

afterEach(async () => {
    await mock.close()
})

describe('createApiClient', () => {
    it('sends Authorization and a spec-compliant User-Agent', async () => {
        let seenAuth = ''
        let seenUa = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/health',
                method: 'GET'
            })
            .reply(200, function () {
                seenAuth = String(this.headers.authorization ?? '')
                seenUa = String(this.headers['user-agent'] ?? '')
                return { status: 'ok', timestamp: 1 }
            })
        const client = createApiClient({ apiKey: 'sk-test' })
        const { data } = await client.GET('/health')
        expect(data?.status).toBe('ok')
        expect(seenAuth).toBe('Bearer sk-test')
        expect(seenUa).toBe(buildUserAgent())
        expect(buildUserAgent()).toMatch(new RegExp(`^chatbase-cli/${VERSION} \\(.+; node/.+\\)$`))
    })

    it('retries 429 using X-RateLimit-Reset and then succeeds', async () => {
        const pool = mock.get(BASE)
        pool.intercept({ path: '/api/v2/health', method: 'GET' }).reply(429, { error: { code: 'RATE_LIMITED', message: 'slow down' } }, {
            headers: { 'X-RateLimit-Reset': String(Date.now() + 20) }
        })
        pool.intercept({ path: '/api/v2/health', method: 'GET' }).reply(200, { status: 'ok', timestamp: 1 })
        const client = createApiClient({ apiKey: 'sk-test' })
        const { data, response } = await client.GET('/health')
        expect(response.status).toBe(200)
        expect(data?.status).toBe('ok')
    })
})

describe('rawApiFetch', () => {
    it('returns status, parsed body, and x-request-id', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/me', method: 'GET' })
            .reply(401, { error: { code: 'AUTH_INVALID_API_KEY', message: 'Invalid API key' } }, {
                headers: { 'x-request-id': 'req_raw' }
            })
        const res = await rawApiFetch('GET', '/me', { apiKey: 'sk-bad' })
        expect(res.status).toBe(401)
        expect(res.requestId).toBe('req_raw')
        expect((res.body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_API_KEY')
    })
})

describe('throwIfError helper via client usage', () => {
    it('produces an ApiError carrying the request id', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/health', method: 'GET' })
            .reply(500, { error: { code: 'INTERNAL', message: 'boom' } }, { headers: { 'x-request-id': 'req_e' } })
        // 5xx GET retries once, so queue the same response again:
        mock.get(BASE)
            .intercept({ path: '/api/v2/health', method: 'GET' })
            .reply(500, { error: { code: 'INTERNAL', message: 'boom' } }, { headers: { 'x-request-id': 'req_e' } })
        const client = createApiClient({ apiKey: 'sk' })
        const { error, response } = await client.GET('/health')
        const { throwIfError } = await import('../../src/client/client.js')
        expect(() => throwIfError(response, error)).toThrow(ApiError)
        try {
            throwIfError(response, error)
        } catch (e) {
            expect((e as ApiError).requestId).toBe('req_e')
            expect((e as ApiError).status).toBe(500)
        }
    })
})
```

Run: `npx vitest run tests/client/client.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement client.ts**

`src/client/client.ts`:

```ts
import os from 'node:os'
import createClient, { type Client } from 'openapi-fetch'
import { EnvHttpProxyAgent, fetch as undiciFetch, getGlobalDispatcher } from 'undici'
import { resolveTimeoutMs } from '../config/resolve.js'
import { ApiError, parseErrorResponse } from '../errors/errors.js'
import type { paths } from '../generated/api.js'
import { VERSION } from '../version.js'
import { computeRetryDelayMs, shouldRetry } from './retry.js'
import { getSigintSignal } from './signals.js'

export const DEFAULT_BASE_URL = 'https://www.chatbase.co/api/v2'

export type ApiClientOptions = {
    apiKey?: string
    timeoutMs?: number
    baseUrl?: string
}

export function buildUserAgent(): string {
    return `chatbase-cli/${VERSION} (${os.platform()}-${os.arch()}; node/${process.versions.node})`
}

const hasProxyEnv = () =>
    ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY'].some(
        (k) => process.env[k] && process.env[k]!.length > 0
    )

let proxyAgent: EnvHttpProxyAgent | undefined

function dispatcher() {
    // Node's fetch ignores HTTP(S)_PROXY by default; EnvHttpProxyAgent honors it.
    if (!hasProxyEnv()) return getGlobalDispatcher()
    proxyAgent ??= new EnvHttpProxyAgent()
    return proxyAgent
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeFetch(opts: ApiClientOptions): typeof undiciFetch {
    const timeoutMs = opts.timeoutMs ?? resolveTimeoutMs()
    return async (input, init) => {
        const method = (init?.method ?? 'GET').toUpperCase()
        for (let attempt = 1; ; attempt++) {
            const response = await undiciFetch(input, {
                ...init,
                dispatcher: dispatcher(),
                signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), getSigintSignal()])
            })
            if (response.ok || !shouldRetry(response.status, method, attempt)) return response
            await sleep(
                computeRetryDelayMs(attempt, response.headers.get('x-ratelimit-reset'), Date.now())
            )
        }
    }
}

export function createApiClient(opts: ApiClientOptions = {}): Client<paths> {
    const client = createClient<paths>({
        baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
        fetch: makeFetch(opts) as unknown as typeof globalThis.fetch
    })
    client.use({
        onRequest({ request }) {
            request.headers.set('User-Agent', buildUserAgent())
            if (opts.apiKey) request.headers.set('Authorization', `Bearer ${opts.apiKey}`)
            return request
        }
    })
    return client
}

export function throwIfError(response: Response, errorBody: unknown): void {
    if (response.ok) return
    throw parseErrorResponse(response.status, errorBody, response.headers.get('x-request-id') ?? undefined)
}

/** Untyped escape hatch — used for endpoints not yet in the vendored spec (/me) and later `chatbase api`. */
export async function rawApiFetch(
    method: string,
    path: string,
    opts: ApiClientOptions = {}
): Promise<{ status: number; requestId?: string; body: unknown }> {
    const response = await makeFetch(opts)(`${opts.baseUrl ?? DEFAULT_BASE_URL}${path}`, {
        method,
        headers: {
            'User-Agent': buildUserAgent(),
            ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {})
        }
    })
    let body: unknown
    try {
        body = await response.json()
    } catch {
        body = undefined
    }
    return {
        status: response.status,
        requestId: response.headers.get('x-request-id') ?? undefined,
        body
    }
}

export { ApiError }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/client && npm run typecheck`
Expected: PASS. (If `AbortSignal.any` combined with undici's fetch types complains, cast the signal: `signal: AbortSignal.any([...]) as AbortSignal`.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: typed HTTP client with retry, timeout, SIGINT abort, proxy support"
```

---

### Task 7: Command base classes

**Files:**
- Create: `src/base/base-command.ts`, `src/base/agent-command.ts`, `src/base/list-command.ts`
- Test: `tests/base/base-command.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–6.
- Produces (consumed by every command in Tasks 8–10 and all later plans):
  - `BaseCommand` (abstract, extends `@oclif/core` `Command`):
    - `static baseFlags = { json, plain, quiet (char q), verbose, 'no-input', 'no-color' }` (all `Flags.boolean`)
    - `protected mode(flags): OutputMode` — via `selectMode`
    - `protected palette(flags): Palette` — via `colorEnabled(process.stderr, flags['no-color'])`
    - `protected note(flags, msg: string): void` — stderr, suppressed by `--quiet`
    - `protected success(flags, msg: string): void` — green `✓ ` + msg on stderr, suppressed by `--quiet`
    - `protected printData(flags, raw: unknown, rows: Record<string, string>[], columns: Column[]): void` — json → `JSON.stringify(raw, null, 2)` to stdout; plain → `renderPlain`; pretty → `renderTable`
    - `protected apiClient(flags): Client<paths>` — resolves key (printing `resolveApiKey().warning` via `note`), throws `UsageError('Not authenticated…')` when no key and `requireAuth` is true
    - `protected requireAuth = true` (subclasses like health set `false`)
    - `async catch(err)` override: `UsageError` → message to stderr, exit 2; `ApiError` → `formatApiError` to stderr (or JSON envelope to stderr when `--json`), exit 1; unexpected → short message + log file in `logsDir()` + pre-filled issue URL, exit 1
    - `async init()` calls `installSigintHandler()`
  - `AgentCommand extends BaseCommand`: adds `agent: Flags.string({ char: 'a' })` to `baseFlags`; `protected agentId(flags): string` — `resolveAgent(flags.agent)` else `UsageError('No agent specified. Pass -a <agentId>, set CHATBASE_AGENT_ID, or add "agent" to chatbase.json.')`
  - `ListCommand extends AgentCommand`: adds `limit: Flags.integer()`, `cursor: Flags.string()`, `all: Flags.boolean()`
- Note: oclif v4 `static baseFlags` participates in flag inheritance; subclasses spread `{ ...BaseCommand.baseFlags, ... }`.

- [ ] **Step 1: Write the failing tests**

`tests/base/base-command.test.ts` (tests the pure/protected logic through a minimal concrete subclass):

```ts
import { Flags } from '@oclif/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseCommand } from '../../src/base/base-command.js'
import { ApiError, UsageError } from '../../src/errors/errors.js'

class Probe extends BaseCommand {
    static override flags = { ...BaseCommand.baseFlags, boom: Flags.string() }
    protected override requireAuth = false
    async run() {
        const { flags } = await this.parse(Probe)
        if (flags.boom === 'usage') throw new UsageError('bad usage')
        if (flags.boom === 'api')
            throw new ApiError({ code: 'AUTH_INVALID_API_KEY', message: 'Invalid API key', status: 401, requestId: 'r1' })
        this.printData(flags, { data: [{ id: 'x1' }] }, [{ id: 'x1' }], [{ key: 'id', header: 'ID' }])
    }
}

describe('BaseCommand', () => {
    afterEach(() => vi.restoreAllMocks())

    it('routes data to stdout as JSON with --json', async () => {
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await Probe.run(['--json'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(JSON.parse(printed)).toEqual({ data: [{ id: 'x1' }] })
    })

    it('exits 2 on UsageError and 1 on ApiError, writing to stderr', async () => {
        const errWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(Probe.run(['--boom', 'usage'], process.cwd())).rejects.toMatchObject({
            oclif: { exit: 2 }
        })
        await expect(Probe.run(['--boom', 'api'], process.cwd())).rejects.toMatchObject({
            oclif: { exit: 1 }
        })
        const stderr = errWrite.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('bad usage')
        expect(stderr).toContain('AUTH_INVALID_API_KEY')
        expect(stderr).toContain('request id: r1')
    })

    it('--quiet suppresses notes but not data', async () => {
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Probe.run(['--quiet', '--plain'], process.cwd())
        expect(out.mock.calls.length).toBeGreaterThan(0)
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toBe('')
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/base`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the three base classes**

`src/base/base-command.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { Command, Flags } from '@oclif/core'
import type { Client } from 'openapi-fetch'
import { createApiClient } from '../client/client.js'
import { installSigintHandler } from '../client/signals.js'
import { resolveApiKey } from '../config/resolve.js'
import { logsDir } from '../config/paths.js'
import { ApiError, formatApiError, UsageError } from '../errors/errors.js'
import { colorEnabled, paint, type Palette } from '../output/color.js'
import { selectMode, type OutputMode } from '../output/mode.js'
import { renderPlain, renderTable, type Column } from '../output/render.js'
import type { paths } from '../generated/api.js'

const ISSUES_URL = 'https://github.com/chatbase-co/chatbase-cli/issues/new'

type BaseFlags = {
    json?: boolean
    plain?: boolean
    quiet?: boolean
    verbose?: boolean
    'no-input'?: boolean
    'no-color'?: boolean
}

export abstract class BaseCommand extends Command {
    static baseFlags = {
        json: Flags.boolean({ description: 'Output raw API JSON', helpGroup: 'OUTPUT' }),
        plain: Flags.boolean({ description: 'Tab-separated output for scripts', helpGroup: 'OUTPUT' }),
        quiet: Flags.boolean({ char: 'q', description: 'Suppress non-essential output' }),
        verbose: Flags.boolean({ description: 'Verbose diagnostics' }),
        'no-input': Flags.boolean({ description: 'Never prompt; fail instead' }),
        'no-color': Flags.boolean({ description: 'Disable colored output' })
    }

    protected requireAuth = true

    override async init(): Promise<void> {
        await super.init()
        installSigintHandler()
    }

    protected mode(flags: BaseFlags): OutputMode {
        return selectMode(flags, process.stdout)
    }

    protected palette(flags: BaseFlags): Palette {
        return paint(colorEnabled(process.stderr, flags['no-color']))
    }

    protected note(flags: BaseFlags, msg: string): void {
        if (!flags.quiet) process.stderr.write(`${msg}\n`)
    }

    protected success(flags: BaseFlags, msg: string): void {
        this.note(flags, `${this.palette(flags).green('✓')} ${msg}`)
    }

    protected printData(
        flags: BaseFlags,
        raw: unknown,
        rows: Record<string, string>[],
        columns: Column[]
    ): void {
        const mode = this.mode(flags)
        if (mode === 'json') {
            process.stdout.write(`${JSON.stringify(raw, null, 2)}\n`)
        } else if (mode === 'plain') {
            if (rows.length > 0) process.stdout.write(`${renderPlain(rows, columns)}\n`)
        } else {
            process.stdout.write(`${renderTable(rows, columns)}\n`)
        }
    }

    protected apiClient(flags: BaseFlags): Client<paths> {
        const resolved = resolveApiKey()
        if (resolved?.warning) this.note(flags, this.palette(flags).yellow(`! ${resolved.warning}`))
        if (!resolved && this.requireAuth) {
            throw new UsageError(
                'Not authenticated. Run `chatbase auth login`, or set CHATBASE_API_KEY.'
            )
        }
        return createApiClient({ apiKey: resolved?.value })
    }

    override async catch(err: unknown): Promise<never> {
        const flags = {} as BaseFlags
        if (err instanceof UsageError) {
            process.stderr.write(`${err.message}\n`)
            this.exit(2)
        }
        if (err instanceof ApiError) {
            if (process.argv.includes('--json')) {
                process.stderr.write(
                    `${JSON.stringify({ error: { code: err.code, message: err.message, details: err.details } }, null, 2)}\n`
                )
            } else {
                process.stderr.write(`${formatApiError(err, this.palette(flags))}\n`)
            }
            this.exit(1)
        }
        // Unexpected: short message + full detail to a log file + pre-filled issue URL.
        const logFile = path.join(logsDir(), `error-${Date.now()}.log`)
        try {
            fs.mkdirSync(logsDir(), { recursive: true })
            fs.writeFileSync(logFile, String((err as Error)?.stack ?? err))
        } catch {
            /* logging must never mask the original failure */
        }
        const title = encodeURIComponent(`bug: ${(err as Error)?.message ?? 'unexpected error'}`)
        const body = encodeURIComponent(
            `CLI: chatbase ${this.config.version}\nOS: ${process.platform}-${process.arch}\nNode: ${process.versions.node}\nCommand: ${this.id}\n`
        )
        process.stderr.write(`✗ Unexpected error: ${(err as Error)?.message ?? err}\n`)
        process.stderr.write(`  details: ${logFile}\n`)
        process.stderr.write(`  report: ${ISSUES_URL}?title=${title}&body=${body}\n`)
        this.exit(1)
    }
}
```

`src/base/agent-command.ts`:

```ts
import { Flags } from '@oclif/core'
import { resolveAgent } from '../config/resolve.js'
import { UsageError } from '../errors/errors.js'
import { BaseCommand } from './base-command.js'

export abstract class AgentCommand extends BaseCommand {
    static override baseFlags = {
        ...BaseCommand.baseFlags,
        agent: Flags.string({ char: 'a', description: 'Agent ID (or set CHATBASE_AGENT_ID / chatbase.json)' })
    }

    protected agentId(flags: { agent?: string }): string {
        const resolved = resolveAgent(flags.agent)
        if (!resolved) {
            throw new UsageError(
                'No agent specified. Pass -a <agentId>, set CHATBASE_AGENT_ID, or add "agent" to chatbase.json.'
            )
        }
        return resolved.value
    }
}
```

`src/base/list-command.ts`:

```ts
import { Flags } from '@oclif/core'
import { AgentCommand } from './agent-command.js'

export abstract class ListCommand extends AgentCommand {
    static override baseFlags = {
        ...AgentCommand.baseFlags,
        limit: Flags.integer({ description: 'Maximum items per page' }),
        cursor: Flags.string({ description: 'Pagination cursor from a previous page' }),
        all: Flags.boolean({ description: 'Fetch every page' })
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/base && npm run typecheck`
Expected: PASS. (oclif's `catch` re-throws exit errors — the `rejects.toMatchObject({ oclif: { exit: N } })` assertions rely on `Command.run` surfacing them; if the shape differs, assert on `error.oclif.exit` via `.catch` inspection and adjust to the actual `ExitError` shape — but do not weaken the exit-code assertions themselves.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: BaseCommand/AgentCommand/ListCommand with output routing and error handling"
```

---

### Task 8: `chatbase health` — first end-to-end command

**Files:**
- Create: `src/commands/health.ts`
- Test: `tests/commands/health.test.ts`

**Interfaces:**
- Consumes: `BaseCommand`, `createApiClient` (via `apiClient`), `throwIfError`.
- Produces: the reference pattern every resource command copies.

- [ ] **Step 1: Write the failing test**

`tests/commands/health.test.ts`:

```ts
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Health from '../../src/commands/health.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
})

describe('chatbase health', () => {
    it('prints ✓ and the API status on success', async () => {
        mock.get(BASE).intercept({ path: '/api/v2/health', method: 'GET' }).reply(200, { status: 'ok', timestamp: 1 })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Health.run([], process.cwd())
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('API is up')
    })

    it('--json prints the raw response to stdout', async () => {
        mock.get(BASE).intercept({ path: '/api/v2/health', method: 'GET' }).reply(200, { status: 'ok', timestamp: 42 })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await Health.run(['--json'], process.cwd())
        expect(JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))).toEqual({ status: 'ok', timestamp: 42 })
    })

    it('exits 1 with a rendered ApiError on failure', async () => {
        mock.get(BASE).intercept({ path: '/api/v2/health', method: 'GET' }).reply(500, { error: { code: 'INTERNAL', message: 'down' } })
        mock.get(BASE).intercept({ path: '/api/v2/health', method: 'GET' }).reply(500, { error: { code: 'INTERNAL', message: 'down' } })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(Health.run([], process.cwd())).rejects.toMatchObject({ oclif: { exit: 1 } })
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/health.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/commands/health.ts`:

```ts
import { throwIfError } from '../client/client.js'
import { BaseCommand } from '../base/base-command.js'

export default class Health extends BaseCommand {
    static override description = 'Check that the Chatbase API is reachable'
    static override examples = ['<%= config.bin %> health', '<%= config.bin %> health --json']
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(Health)
        const client = this.apiClient(flags)
        const { data, error, response } = await client.GET('/health')
        throwIfError(response, error)
        if (this.mode(flags) === 'json') {
            process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
            return
        }
        this.success(flags, `API is up (status: ${data?.status})`)
    }
}
```

- [ ] **Step 4: Run tests, then verify the real binary**

Run: `npx vitest run tests/commands/health.test.ts && npm run build && node bin/run.js health`
Expected: tests PASS; live run prints `✓ API is up (status: ok)` (network permitting — the live check is a smoke test, not part of CI).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: health command — first end-to-end vertical slice"
```

---

### Task 9: `chatbase auth login / logout / status`

**Files:**
- Create: `src/commands/auth/login.ts`, `src/commands/auth/logout.ts`, `src/commands/auth/status.ts`
- Test: `tests/commands/auth.test.ts`

**Interfaces:**
- Consumes: `rawApiFetch` (untyped `/me` — not in the vendored spec yet), `readUserConfig`/`writeUserConfig`, `resolveApiKey`, base classes.
- Produces: stored credential consumed by every authenticated command.
- Behavior contract (spec §5):
  - `login` interactive: masked prompt (via `@inquirer/prompts` `password`, **dynamically imported inside run()** to protect startup time) — only when stdin is a TTY and `--no-input` absent; otherwise `UsageError` pointing at `--with-token`.
  - `login --with-token`: read the key from stdin (piped).
  - Verification: `rawApiFetch('GET', '/me', { apiKey })` → `200`: success + workspace name; `401/403`: fail, do NOT store, exit 1; `404` (endpoint not shipped yet): store anyway + note `key stored (verification unavailable — it will be checked on first use)`.
  - `logout`: delete `apiKey` from user config; note if nothing stored.
  - `status`: show active credential source (`CHATBASE_API_KEY_FILE` / `CHATBASE_API_KEY` / `user config` / none) + key tail (last 4 chars) + `/me` workspace/plan when available.

- [ ] **Step 1: Write the failing tests**

`tests/commands/auth.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from '../../src/commands/auth/login.js'
import Logout from '../../src/commands/auth/logout.js'
import Status from '../../src/commands/auth/status.js'
import { readUserConfig } from '../../src/config/store.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('XDG_CONFIG_HOME', fs.mkdtempSync(path.join(os.tmpdir(), 'cb-auth-')))
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

function stubStdinToken(token: string) {
    // login --with-token reads stdin to end
    const stdin = require('node:stream').Readable.from([`${token}\n`]) as NodeJS.ReadStream
    Object.defineProperty(stdin, 'isTTY', { value: false })
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)
}

describe('auth login --with-token', () => {
    it('verifies via /me and stores the key', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/me', method: 'GET' })
            .reply(200, { workspace: { id: 'w1', name: 'Acme' }, plan: 'standard' })
        stubStdinToken('sk-live-1234')
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Login.run(['--with-token'], process.cwd())
        expect(readUserConfig().apiKey).toBe('sk-live-1234')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('Acme')
    })

    it('stores unverified when /me does not exist yet (404)', async () => {
        mock.get(BASE).intercept({ path: '/api/v2/me', method: 'GET' }).reply(404, { error: { code: 'NOT_FOUND', message: 'no' } })
        stubStdinToken('sk-live-x')
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Login.run(['--with-token'], process.cwd())
        expect(readUserConfig().apiKey).toBe('sk-live-x')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toMatch(/verification unavailable/i)
    })

    it('rejects and does NOT store on 401', async () => {
        mock.get(BASE).intercept({ path: '/api/v2/me', method: 'GET' }).reply(401, { error: { code: 'AUTH_INVALID_API_KEY', message: 'Invalid API key' } })
        stubStdinToken('sk-bad')
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(Login.run(['--with-token'], process.cwd())).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(readUserConfig().apiKey).toBeUndefined()
    })

    it('refuses to prompt with --no-input and no token', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(Login.run(['--no-input'], process.cwd())).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('auth logout / status', () => {
    it('logout removes the stored key', async () => {
        const { writeUserConfig } = await import('../../src/config/store.js')
        writeUserConfig({ apiKey: 'sk-z' })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Logout.run([], process.cwd())
        expect(readUserConfig().apiKey).toBeUndefined()
    })

    it('status names the credential source and masks the key', async () => {
        vi.stubEnv('CHATBASE_API_KEY', 'sk-env-abcd')
        mock.get(BASE).intercept({ path: '/api/v2/me', method: 'GET' }).reply(404, {})
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Status.run([], process.cwd())
        const outText = err.mock.calls.map((c) => String(c[0])).join('')
        expect(outText).toContain('CHATBASE_API_KEY')
        expect(outText).toContain('…abcd')
        expect(outText).not.toContain('sk-env-abcd')
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/auth.test.ts`
Expected: FAIL — modules not found. (The `require('node:stream')` in an ESM test file will also fail — replace with `import { Readable } from 'node:stream'` at the top; keep the helper.)

- [ ] **Step 3: Implement the three commands**

`src/commands/auth/login.ts`:

```ts
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { rawApiFetch } from '../../client/client.js'
import { readUserConfig, writeUserConfig } from '../../config/store.js'
import { configFile } from '../../config/paths.js'
import { parseErrorResponse, UsageError } from '../../errors/errors.js'

async function readStdinToEnd(): Promise<string> {
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data.trim()
}

export default class AuthLogin extends BaseCommand {
    static override description = 'Authenticate with a Chatbase workspace API key'
    static override examples = [
        '<%= config.bin %> auth login',
        'cat key.txt | <%= config.bin %> auth login --with-token'
    ]
    static override flags = {
        ...BaseCommand.baseFlags,
        'with-token': Flags.boolean({ description: 'Read the API key from stdin' })
    }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(AuthLogin)

        let key: string
        if (flags['with-token']) {
            key = await readStdinToEnd()
            if (!key) throw new UsageError('No token received on stdin.')
        } else if (process.stdin.isTTY && !flags['no-input']) {
            this.note(flags, 'Paste your API key (chatbase.co → Workspace Settings → API Keys)')
            const { password } = await import('@inquirer/prompts')
            key = (await password({ message: 'Key:', mask: '●' })).trim()
            if (!key) throw new UsageError('No key entered.')
        } else {
            throw new UsageError('Cannot prompt (no TTY or --no-input). Use: chatbase auth login --with-token < key.txt')
        }

        const res = await rawApiFetch('GET', '/me', { apiKey: key })
        if (res.status === 200) {
            const body = res.body as { workspace?: { name?: string }; plan?: string }
            writeUserConfig({ ...readUserConfig(), apiKey: key })
            this.success(flags, `Logged in${body.workspace?.name ? ` to workspace ${body.workspace.name}` : ''}`)
        } else if (res.status === 404) {
            writeUserConfig({ ...readUserConfig(), apiKey: key })
            this.note(flags, 'Key stored (verification unavailable — it will be checked on first use).')
        } else {
            throw parseErrorResponse(res.status, res.body, res.requestId)
        }
        this.note(flags, `Saved to ${configFile()}`)
    }
}
```

`src/commands/auth/logout.ts`:

```ts
import { BaseCommand } from '../../base/base-command.js'
import { readUserConfig, writeUserConfig } from '../../config/store.js'

export default class AuthLogout extends BaseCommand {
    static override description = 'Remove the stored API key'
    static override examples = ['<%= config.bin %> auth logout']
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(AuthLogout)
        const config = readUserConfig()
        if (!config.apiKey) {
            this.note(flags, 'No stored credential — nothing to remove.')
            return
        }
        const { apiKey: _removed, ...rest } = config
        writeUserConfig(rest)
        this.success(flags, 'Logged out (stored key removed).')
    }
}
```

`src/commands/auth/status.ts`:

```ts
import { BaseCommand } from '../../base/base-command.js'
import { rawApiFetch } from '../../client/client.js'
import { resolveApiKey } from '../../config/resolve.js'

export default class AuthStatus extends BaseCommand {
    static override description = 'Show the active credential and where it comes from'
    static override examples = ['<%= config.bin %> auth status']
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(AuthStatus)
        const resolved = resolveApiKey()
        if (!resolved) {
            this.note(flags, 'Not authenticated. Run `chatbase auth login`.')
            return
        }
        this.note(flags, `Credential: …${resolved.value.slice(-4)} (from ${resolved.source})`)
        const res = await rawApiFetch('GET', '/me', { apiKey: resolved.value })
        if (res.status === 200) {
            const body = res.body as { workspace?: { name?: string }; plan?: string }
            this.note(flags, `Workspace: ${body.workspace?.name ?? 'unknown'} (plan: ${body.plan ?? 'unknown'})`)
        } else if (res.status === 401 || res.status === 403) {
            this.note(flags, this.palette(flags).yellow('! Key appears invalid or lacks API access.'))
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/auth.test.ts && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: auth login/logout/status with /me verification and graceful fallback"
```

---

### Task 10: `chatbase conversations list` — the ListCommand exemplar

**Files:**
- Create: `src/commands/conversations/list.ts`
- Test: `tests/commands/conversations-list.test.ts`

**Interfaces:**
- Consumes: `ListCommand`, typed client (`GET /agents/{agentId}/conversations`, query `{ cursor?, limit? }`, response `{ data: Array<{ id, title, createdAt, updatedAt, userId, status }>, pagination: { cursor?, hasMore, total } }` — exact shapes from the vendored spec).
- Produces: the pagination/table pattern every list command in Plan 2 copies. Pretty/plain column order (append-only from here on): `id, title, status, createdAt, updatedAt`.

- [ ] **Step 1: Write the failing tests**

`tests/commands/conversations-list.test.ts`:

```ts
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversationsList from '../../src/commands/conversations/list.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

const page1 = {
    data: [
        { id: 'c_1', title: 'Refunds', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z', userId: 'u1', status: 'open' }
    ],
    pagination: { cursor: 'cur_2', hasMore: true, total: 2 }
}
const page2 = {
    data: [
        { id: 'c_2', title: 'Hello', createdAt: '2026-08-03T00:00:00Z', updatedAt: '2026-08-03T01:00:00Z', userId: 'u2', status: 'closed' }
    ],
    pagination: { hasMore: false, total: 2 }
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase conversations list', () => {
    it('renders a plain TSV row per conversation with stable column order', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/conversations', method: 'GET' })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['-a', 'agt_1', '--plain'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('c_1\tRefunds\topen\t2026-08-01T00:00:00Z\t2026-08-02T00:00:00Z')
        // Next-page hint goes to stderr, never stdout:
        expect(printed).not.toContain('cur_2')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('--cursor cur_2')
    })

    it('--all follows pagination to the end', async () => {
        const pool = mock.get(BASE)
        pool.intercept({ path: '/api/v2/agents/agt_1/conversations', method: 'GET' }).reply(200, page1)
        pool.intercept({ path: '/api/v2/agents/agt_1/conversations', method: 'GET', query: { cursor: 'cur_2' } }).reply(200, page2)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['-a', 'agt_1', '--plain', '--all'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('c_1')
        expect(printed).toContain('c_2')
    })

    it('--json emits the raw API envelope', async () => {
        mock.get(BASE).intercept({ path: '/api/v2/agents/agt_1/conversations', method: 'GET' }).reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['-a', 'agt_1', '--json'], process.cwd())
        expect(JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))).toEqual(page1)
    })

    it('fails with a usage error when no agent is resolvable', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        vi.stubEnv('CHATBASE_AGENT_ID', '')
        await expect(
            ConversationsList.run(['--plain'], '/tmp') // /tmp: no chatbase.json above it
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/conversations-list.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/commands/conversations/list.ts`:

```ts
import { ListCommand } from '../../base/list-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'title', header: 'TITLE' },
    { key: 'status', header: 'STATUS' },
    { key: 'createdAt', header: 'CREATED' },
    { key: 'updatedAt', header: 'UPDATED' }
]

export default class ConversationsList extends ListCommand {
    static override description = 'List conversations for an agent'
    static override examples = [
        '<%= config.bin %> conversations list -a agt_123',
        '<%= config.bin %> conversations list -a agt_123 --all --json'
    ]
    static override flags = { ...ListCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsList)
        const agentId = this.agentId(flags)
        const client = this.apiClient(flags)

        type Page = {
            data: Array<Record<string, string>>
            pagination: { cursor?: string; hasMore: boolean; total: number }
        }

        const pages: Page[] = []
        let cursor = flags.cursor
        for (;;) {
            const { data, error, response } = await client.GET('/agents/{agentId}/conversations', {
                params: {
                    path: { agentId },
                    query: { cursor, limit: flags.limit }
                }
            })
            throwIfError(response, error)
            const page = data as unknown as Page
            pages.push(page)
            if (!flags.all || !page.pagination.hasMore || !page.pagination.cursor) break
            cursor = page.pagination.cursor
        }

        const rows = pages.flatMap((p) =>
            p.data.map((c) => ({
                id: c.id ?? '',
                title: c.title ?? '',
                status: c.status ?? '',
                createdAt: c.createdAt ?? '',
                updatedAt: c.updatedAt ?? ''
            }))
        )
        const last = pages.at(-1)
        const raw = pages.length === 1 ? pages[0] : { data: rows, pagination: last?.pagination }

        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(flags, `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/conversations-list.test.ts && npm run typecheck`
Expected: PASS. (If the generated types make `query` fully optional-object, passing `{ cursor: undefined, limit: undefined }` is fine; if tsc complains about `Page` casting, keep the cast — the spec's generated response type is the authority and the cast is localized here.)

- [ ] **Step 5: Full-suite regression + commit**

Run: `npm run lint && npm test && npm run build`
Expected: all green.

```bash
git add -A
git commit -m "feat: conversations list with cursor pagination, --all, and output modes"
```

---

### Task 11: Help polish, README, startup budget, CI

**Files:**
- Create: `README.md`, `scripts/check-startup.mjs`, `.github/workflows/ci.yml`
- Modify: `package.json` (bug-report URL field), `tests/scaffold.test.ts` (help-content assertions)

**Interfaces:**
- Produces: CI pipeline (lint, typecheck, tests, spec:check, startup budget) on Node 20/22 × ubuntu/macos; README with install/uninstall + auto-generated command reference markers.

- [ ] **Step 1: Extend the scaffold test with help-quality assertions**

Append to `tests/scaffold.test.ts`:

```ts
it('command help shows examples and docs link', () => {
    const out = execFileSync('node', ['bin/run.js', 'auth', 'login', '--help'], { encoding: 'utf8' })
    expect(out).toContain('EXAMPLES')
    expect(out).toContain('auth login')
})

it('trailing -h anywhere shows help', () => {
    const out = execFileSync('node', ['bin/run.js', 'conversations', 'list', '-h'], { encoding: 'utf8' })
    expect(out).toContain('USAGE')
})
```

Run: `npm run build && npx vitest run tests/scaffold.test.ts` — expected PASS (oclif provides both; if EXAMPLES is missing, the command lacks `static examples` — fix the command, not the test).

- [ ] **Step 2: Startup budget script**

`scripts/check-startup.mjs`:

```js
import { execFileSync } from 'node:child_process'

const BUDGET_MS = Number(process.env.STARTUP_BUDGET_MS ?? 1000) // CI runners are slow; local target is 300
const runs = []
for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    execFileSync('node', ['bin/run.js', '--version'])
    runs.push(performance.now() - t0)
}
const best = Math.min(...runs)
console.log(`startup (best of 3): ${best.toFixed(0)}ms (budget ${BUDGET_MS}ms)`)
if (best > BUDGET_MS) {
    console.error('Startup budget exceeded')
    process.exit(1)
}
```

Run: `npm run build && node scripts/check-startup.mjs` — expected: well under budget locally.

- [ ] **Step 3: README with uninstall at the bottom of install**

`README.md`:

```markdown
# chatbase

The official CLI for the [Chatbase API v2](https://www.chatbase.co/docs/api-v2/overview).

## Install

​```sh
npm install -g chatbase   # or: npx chatbase <command>
​```

Requires Node 20+.

### Uninstall

​```sh
npm uninstall -g chatbase
rm -rf ~/.config/chatbase ~/.local/state/chatbase ~/.cache/chatbase
​```

## Authenticate

​```sh
chatbase auth login                       # interactive (paste your API key)
chatbase auth login --with-token < key.txt
export CHATBASE_API_KEY=...               # CI
​```

Keys live in chatbase.co → Workspace Settings → API Keys (Standard plan or higher).

## Privacy

The CLI sends no telemetry. Requests carry a `chatbase-cli/<version>` User-Agent so
Chatbase can distinguish CLI traffic server-side. The only network calls are the API
calls you invoke.

<!-- commands -->
<!-- commandsstop -->
```

(The `<!-- commands -->` markers are where `oclif readme` injects the generated reference — wired into CI in a later plan; leaving markers now costs nothing.)

- [ ] **Step 4: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
    push: { branches: [main] }
    pull_request:
jobs:
    test:
        strategy:
            matrix:
                os: [ubuntu-latest, macos-latest]
                node: [20, 22]
        runs-on: ${{ matrix.os }}
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with: { node-version: '${{ matrix.node }}' }
            - run: npm ci
            - run: npm run lint
            - run: npm run typecheck
            - run: npm run spec:check
            - run: npm test
            - run: npm run build
            - run: node scripts/check-startup.mjs
```

(Windows joins the matrix in Plan 4 alongside `oclif pack` — the 0600-permission test needs its platform guard first; adding two OSes now keeps signal high without churn.)

- [ ] **Step 5: Add the bug-report URL and finish**

In `package.json` add:

```json
{
    "bugs": "https://github.com/chatbase-co/chatbase-cli/issues",
    "homepage": "https://www.chatbase.co/docs"
}
```

(If the real GitHub org/repo name differs, update `ISSUES_URL` in `src/base/base-command.ts` and here together.)

Run: `npm run lint && npm test && npm run build && node scripts/check-startup.mjs`
Expected: all green.

```bash
git add -A
git commit -m "chore: README, startup budget check, and CI workflow"
```

---

## Self-review results (run before handoff)

- **Spec coverage (Plan 1 scope):** §2 ✓ Tasks 1–2, 6–7 · §4 flags ✓ Tasks 7, 9 · §5 auth v1.0 ✓ Task 9 · §6 config ✓ Task 4 · §7 output ✓ Tasks 5, 7, 10 · §9 errors ✓ Tasks 3, 7 · §10 robustness fundamentals (timeout/retry/SIGINT/atomic writes/startup) ✓ Tasks 4, 6, 11. Deliberately deferred to Plans 2–4: remaining commands, `api` escape hatch, `docs`/`config` commands, REPL, sync, MCP, `oclif readme` automation, e2e smoke, release-please, Windows CI, spinner/progress UI (needs long-running commands to exist first).
- **Known deviations, by design:** tsc instead of tsup (oclif lazy loading; startup enforced by test). The vendored spec is the full 25-path output of the private repo's routes-only generator (built 2026-08-06) — Plan 2 is no longer blocked on spec coverage.
- **Type consistency:** `Resolved`/`UserConfig`/`Column`/`Palette`/`OutputMode`/`ApiClientOptions` names match across Tasks 4–10; command tests import concrete classes and run them directly with `Class.run(argv, root)`.
