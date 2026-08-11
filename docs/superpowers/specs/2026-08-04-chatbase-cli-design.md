# Chatbase CLI — Design Specification

**Date:** 2026-08-04
**Status:** Approved for planning
**Repo:** `chatbase-cli` (public) · **npm:** `chatbase` · **binary:** `chatbase`

---

## 1. Purpose & scope

`chatbase` is a public, open-source command-line interface providing complete
access to the Chatbase API v2 (`https://www.chatbase.co/api/v2`). It serves
three audiences with equal priority:

1. **Humans** exploring and operating their agents from a terminal.
2. **Scripts & CI** automating knowledge-source updates, exports, and checks.
3. **AI agents** (Claude, etc.) driving Chatbase either by shelling out to the
   CLI or natively through its built-in MCP server.

### V1 scope

- Every API v2 endpoint exposed as a dedicated command (34 operations across
  25 paths as of 2026-08-06 — including the agents CRUD and helpdesk groups
  added that week).
- Interactive **chat REPL** with SSE streaming (`chatbase chat`).
- ~~**MCP server mode** (`chatbase mcp`)~~ — **descoped from v1 (2026-08-11,
  user decision); deferred to a future release.** §12 remains the design for
  when it's greenlit. Agent-driven usage in v1 is served by the CLI itself.
- **Raw API escape hatch** (`chatbase api <method> <path>`) for endpoints that
  ship before the CLI updates.
- **`sources sync <dir>`** — converge an agent's file sources to a local folder.
- Auth via pasted workspace API keys (browser pairing login is a planned
  v1.x addition; see §5 and the pairing-login server-side design doc in the
  private repo).

### Non-goals (deliberate, recorded)

- No man pages (revisit if requested; oclif help content can export via ronn).
- No output pager (API cursor pagination + `--all` replaces it).
- No telemetry or phone-home of any kind (see §15).
- No command aliases or prefix abbreviations in v1.
- No self-update command (npm/brew own updates).
- No auto-editing of other programs' config files (MCP setup prints snippets).
- No `.env` auto-loading (`direnv` + `chatbase.json` cover the use cases).
- No named profiles/multi-workspace switching in v1 (env vars + project config
  cover it; revisit on demand).

---

## 2. Architecture

### Stack

- **TypeScript**, Node ≥ 20, ESM only.
- **oclif** framework (`@oclif/core`): uniform auto-generated help, built-in
  `--json` convention, per-command lazy loading, plugin system, and
  `oclif pack` for future binary distribution. Space topic separator
  (`chatbase sources list`).
- **Biome** (lint/format, matching the main repo), **Vitest** (tests),
  **tsup** (build).
- Key plugins: `@oclif/plugin-not-found` ("did you mean?"),
  `@oclif/plugin-warn-if-update-available` (async, cached, disableable).

### The spec pipeline (core architectural bet)

The API's single source of truth is the Zod route definitions in the private
`chatbase` repo (`src/lib/api/v2`, Hono + `@hono/zod-openapi`).

```
Zod routes (private repo)
  → npm run generate:openapi            (private repo, artifact gitignored)
  → spec/openapi.json                   (vendored HERE, committed)
  → openapi-typescript                  (build step)
  → src/generated/api.d.ts              (committed, types only)
  → openapi-fetch client                (~6 kB runtime, fully typed)
```

- Both generated artifacts are **committed** so the public repo builds
  standalone and API changes appear as reviewable diffs.
- **Refresh flow:** `npm run spec:refresh` — regenerates the spec in a sibling
  `../chatbase` checkout, copies it in, reruns `openapi-typescript`, runs
  `tsc`. Compile errors then point at every command affected by the API
  change. (If the private-repo→docs spec sync is later automated, refresh can
  pull from the docs repo instead; nothing else changes.)
- **CI check:** regenerate types from the vendored spec and fail on diff, so
  spec and types can never drift from each other.

### Layers

```
src/
├── client/       All HTTP: openapi-fetch wrapper, bearer auth, retry/backoff,
│                 SSE parsing, proxy agent, timeout, error envelope mapping.
│                 The ONLY place fetch exists.
├── commands/     One file per command (oclif layout). Parse flags → call
│                 client → hand data to output layer. Never touches fetch.
├── output/       Pretty tables / plain TSV / JSON rendering, color rules,
│                 spinners, progress.
├── config/       Credential store + config resolution (flag>env>project>user).
├── mcp/          MCP server: tool definitions derived from the spec.
└── generated/    api.d.ts (openapi-typescript output).
```

Shared behavior is enforced by inheritance, not convention:

- `BaseCommand` — `--json/--plain/--quiet/--verbose/--no-input`, error
  rendering, exit codes, color/TTY rules.
- `AgentCommand extends BaseCommand` — resolves `-a/--agent` (flag →
  `CHATBASE_AGENT_ID` → project config → user config).
- `ListCommand extends AgentCommand` — pagination trio `--limit/--cursor/--all`.

---

## 3. Command tree

| Command | API mapping / behavior |
|---|---|
| `agents list/get/create/update/delete` | `GET /agents`, `POST /agents`, `GET/PUT/DELETE /agents/{agentId}`; `delete` is severe-tier (typed confirmation, `--confirm <agentId>` for scripts) |
| `agents clone` | `POST /agents/{agentId}/clone` |
| `agents train` | `POST /agents/{agentId}/train` |
| `agents auto-retrain` | `PUT /agents/{agentId}/auto-retrain` |
| `agents styles` | `PUT /agents/{agentId}/styles` |
| `tickets list/get/create/update` | helpdesk tickets CRUD (`.../helpdesk/tickets[/{ticketNumber}]`) |
| `tickets messages` | `GET .../helpdesk/tickets/{ticketNumber}/messages` (`--ticket`) |
| `tickets reply` | `POST .../helpdesk/tickets/{ticketNumber}/messages` (`--ticket`, `-m`) |
| `helpdesk teams` / `helpdesk statuses` | `GET .../helpdesk/teams`, `GET .../helpdesk/ticket-statuses` |
| `auth login` | interactive key paste (masked) or `--with-token < file`; verifies via `GET /me`; stores 0600 |
| `auth logout` | remove stored credential |
| `auth status` | active credential, its source, workspace/plan via `/me` |
| `chat` | `POST /agents/{id}/chat`. `-m` = one-shot; no `-m` + TTY = REPL; no `-m` + piped stdin = message from stdin |
| `chat retry` | `POST .../conversations/{id}/retry` |
| `conversations list` | `GET .../conversations`; `--user <id>` switches to `GET .../users/{userId}/conversations` |
| `conversations get` | `GET .../conversations/{id}` |
| `conversations export` | `GET .../conversations/export`; stdout by default, `-o file` |
| `messages list` | `GET .../conversations/{id}/messages` (`--conversation`) |
| `messages feedback` | `PATCH .../messages/{id}/feedback`; `--conversation`, `--message`, `--rating positive\|negative\|clear` |
| `tools submit-result` | `POST .../tool-result` |
| `sources list/get/create/update/delete/restore/summary` | full sources CRUD; `create` supports `--type text\|qna\|link` (JSON body) and `--file` (upload via `files.chatbase.co/api/v2`) |
| `sources sync <dir>` | workflow — see §17 |
| `api <method> <path>` | raw escape hatch; `--field k=v`, `--body @file`, `--body @-` (stdin) |
| `mcp` | stdio MCP server; `--setup` prints per-client config snippets |
| `config get/set/list` | manage user + project config; `list` shows each value **with its source** |
| `docs [command]` | open web docs (or print URL when no TTY/browser) |
| `health` | `GET /health` |

Rules:

- **Closed verb set:** `list, get, create, update, delete` + domain verbs
  `restore, export, sync, retry, clone, train, reply`. No synonyms ever (`delete` not `rm`, `get`
  not `show`, `list` not `ls`). One recorded exception: `messages feedback`
  (noun, matches API naming).
- **Max two levels** (`noun verb`), max **one positional** per command (the
  primary resource ID or path). Multi-ID commands use flags.
- No catch-all default command: bare `chatbase` shows help.

---

## 4. Flags & interactivity

Short flags are reserved for the workhorses; everything has a long form:

| Short | Long | Notes |
|---|---|---|
| `-a` | `--agent` | deviation: `-a` ≠ `--all` because agent ID is our most-typed flag; `--all` is long-only |
| `-m` | `--message` | one-shot chat |
| `-q` | `--quiet` | suppress non-essential output |
| `-f` | `--force` | skip confirmations (scripts) |
| `-n` | `--dry-run` | preview (sync) |
| `-o` | `--output` | output file (export) |
| `-h` | `--help` | help and nothing else |
| — | `--json --plain --verbose --version --all --no-input --no-color --cursor --limit` | long-only; `-v` and `-d` deliberately unassigned |

- **Prompts:** only when stdin is a TTY; every prompt has a flag equivalent;
  `--no-input` fails instead of prompting (the flag CI/agents always pass).
  Secret prompts disable echo.
- **Danger tiers:** `sources delete` = no confirm (explicit verb, restorable —
  prints the `sources restore` hint). `sources sync` = plan + y/N confirm,
  `--force` for scripts, `--dry-run` preview; deleting >50 % of an agent's
  file sources escalates to typing the agent ID (still `--force`-able).
  `agents delete` = severe tier: not restorable, deletes a whole agent —
  interactive requires typing the agent ID; scripts pass `--confirm <agentId>`
  (`--force` alone is NOT accepted).
- **`-` conventions:** `--body @-` reads stdin; export writes stdout.
- **No-hang rule:** any command expecting piped input checks
  `process.stdin.isTTY`; if interactive, print concise help to stderr and exit
  non-zero rather than blocking.
- **Secrets never pass through flags.** No `--api-key` flag exists.

---

## 5. Auth & credential store

API v2 authenticates with **workspace API keys** (Bearer). The CLI's
credential store is **token-agnostic** from day one: every command asks it for
a bearer token; it doesn't care what kind.

**V1.0 — API key paste:**

```
$ chatbase auth login
  Key: ●●●●●●●●        (echo off)
  ✓ Key verified        (GET /me)
  ✓ Saved to ~/.config/chatbase/config.json (0600)
```

Non-interactive: `auth login --with-token < key.txt`.

**Runtime resolution order:** `CHATBASE_API_KEY_FILE` (path to a file — the
Docker/K8s/systemd secrets pattern, recommended for containers) →
`CHATBASE_API_KEY` (CI convenience) → user config file. If both env vars are
set, `_FILE` wins with a warning. `auth status` names the active source.

**V1.x — browser pairing login:** `auth login` gains a second path ("Log in
with browser"): CLI shows a short user code and opens
`chatbase.co/activate`; the user approves in their existing dashboard
session; **the server mints a workspace API key tagged `source: 'cli'`**
(hidden from the main key list, shown under a "CLI sessions" dashboard
section, per-device revocable) and the CLI receives it via polling. The
stored credential is a plain API key, so nothing else in the CLI changes —
no refresh logic, no token expiry handling. **Server-side dependency** —
designed separately in the private repo
(`2026-08-05-cli-pairing-login-design.md`); lands in a minor release, purely
additive. CI keeps using API keys regardless. Full OAuth (expiring tokens,
scopes) is explicitly deferred; the credential store stays token-agnostic so
it could slot in later.

**Private-repo dependency for v1.0:** a minimal authenticated **`GET /me`**
endpoint returning key/workspace metadata (workspace name, plan). Fallback if
it can't ship in time: `auth login` stores the key unverified and the first
real command validates it (friendly `AUTH_INVALID_API_KEY` rendering either
way).

---

## 6. Configuration

Precedence (highest wins):

```
flag  >  env var  >  project chatbase.json  >  user config
```

- **Project config `chatbase.json`** — found by walking up from cwd (like
  `.git`); committed to the repo; holds team-shared, non-secret settings:

  ```json
  { "agent": "agt_abc123", "sync": { "dir": "./docs", "exclude": ["*.tmp"] } }
  ```

  **Never secrets.** If a key-shaped value is found here, the CLI refuses to
  run with a pointed error.
- **User config** — `~/.config/chatbase/config.json` (XDG, incl. macOS).
  Logs → `~/.local/state/chatbase/logs/` (`XDG_STATE_HOME`). Update-check
  cache → `XDG_CACHE_HOME/chatbase`. Nothing else on disk, no `$HOME` dotfiles.
- **Env namespace:** `CHATBASE_API_KEY`, `CHATBASE_API_KEY_FILE`,
  `CHATBASE_AGENT_ID`, `CHATBASE_TIMEOUT`, `CHATBASE_NO_COLOR`,
  `CHATBASE_NO_UPDATE_NOTIFIER`. Single-line values, uppercase+underscores.
- **General-purpose env honored:** `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`,
  `COLUMNS`, `TMPDIR`, `DEBUG=chatbase*` (verbose HTTP tracing), and
  `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` — **Node's fetch ignores proxy vars
  by default; the client wires undici's `EnvHttpProxyAgent`** so they work.
- **No `.env` auto-loading** (deviation from clig, recorded): conflicts with
  the "no implicit file reads" rule; `chatbase.json` covers projects, `direnv`
  covers env-per-directory.

---

## 7. Output & formatting

**Stream discipline (the foundational rule):** data → stdout; everything else
(progress, confirmations, hints, spinners) → stderr. Chat streams tokens to
stdout; status chatter to stderr.

Three modes per data command:

| Mode | Trigger | Shape |
|---|---|---|
| Pretty | stdout is a TTY | aligned table, minimal color, glyphs `✓ … ✗` |
| Plain | piped stdout, or `--plain` | one record/line, tab-separated |
| JSON | `--json` | pretty-printed, **exactly the raw API response shape** |

- `--json` mirroring API responses means the API docs double as CLI output
  docs and there is **one** compatibility contract, not two.
- **State changes narrate briefly:** `✓ Created source src_abc123 (processing)`
  on stderr, bare ID on stdout (`ID=$(chatbase sources create …)` works).
  `-q` silences everything but errors.
- **Next-step suggestions** where workflows continue (create → `sources get`
  to watch processing; sync dry-run → rerun to apply; REPL exit →
  conversation ID + resume hint).
- **Color:** red=error, yellow=warning, green=success — the whole palette.
  Disabled per-stream when not a TTY, or via `NO_COLOR`, `TERM=dumb`,
  `--no-color`, `CHATBASE_NO_COLOR`; `FORCE_COLOR` overrides detection.
- **No animations when stderr isn't a TTY** (CI logs get plain lines).
- **No pager** (deviation, recorded): cursor pagination + `--limit/--cursor/
  --all` + hint line replace it.
- Verbose/debug output (HTTP traces, timing) only under `--verbose`/`DEBUG`;
  stderr never carries `[WARN]`-style log labels in normal mode. Exception:
  API errors always show `x-request-id` (support needs it).

---

## 8. Help & UX conventions

- `-h`, `--help`, `help`, `help <topic> <cmd>`, and trailing `-h` anywhere all
  work (oclif). Bare `chatbase` → help.
- **Concise vs full:** command invoked with missing required input shows
  description + one example + "use --help"; full help shows everything.
- **Examples-first:** every command ships ≥1 realistic example; custom help
  class renders EXAMPLES above OPTIONS. Root help orders common commands
  first (`chat`, `sources`, `conversations`), git-style.
- **"Did you mean?"** via `@oclif/plugin-not-found` — suggests, never
  auto-executes.
- **Docs links:** root help footer → GitHub issues + chatbase.co/docs; each
  command's help links its specific docs anchor. `chatbase docs [command]`
  opens the right page (prints URL when no TTY/browser).
- **README reference auto-generated** by `oclif readme` in CI — can't drift.
- Web docs: CLI section in the Mintlify docs repo (install, auth, CI recipes,
  command reference). Uninstall instructions at the bottom of install docs.

---

## 9. Errors

- **Known API error codes → human rewrites with remediation**, driven by one
  map keyed on the API's structured codes (`AUTH_*`, `VALIDATION_*`,
  `RESOURCE_*`, subscription/plan errors). Auth errors point at
  `chatbase auth login` and where keys live; plan errors point at upgrade;
  agent 404s suggest `chatbase agents list`.
- **Validation errors grouped:** one header + field-level `details` list +
  remediation last. Red only on the first `✗` line; most important info last.
- **Rate limits are handled, not shown:** auto-retry with backoff honoring
  `X-RateLimit-Reset` (safe for POSTs — a 429'd request never executed);
  surfaced only when retries exhaust ("resets in 42s"). GETs additionally
  retry once on 5xx.
- **Unexpected errors:** ≤3 lines (what failed, `x-request-id`, log path);
  full traceback + redacted request metadata written to
  `~/.local/state/chatbase/logs/`; final line is a **pre-filled GitHub issue
  URL** (CLI version, OS, Node, command, error code, request ID — never the
  key or body).
- **Exit codes:** `0` success · `1` API/runtime error · `2` usage error.
- With `--json`, errors emit the raw API error envelope as JSON on stderr —
  same structured contract on failure as success.

---

## 10. Robustness

- **Validation split:** validate locally only what can't drift (flag enums,
  file existence/readability, non-empty IDs → exit 2). Semantic validation
  belongs to the API; our error layer makes its 400s readable.
- **Responsiveness:** spinner (stderr, TTY-only) starts before every network
  request. Cold-start budget: first output < 300 ms, protected by lazy
  loading + a CI `time chatbase --version` check.
- **Progress:** sync/uploads show live per-file progress in a TTY,
  line-per-completion in CI; failures hidden behind progress UI are
  **re-printed in full at the end**.
- **Parallelism:** sync uploads capped at concurrency 4 (respects rate
  limits, keeps output sane).
- **Timeouts:** 30 s per request default (`CHATBASE_TIMEOUT` to change);
  streaming uses a 60 s idle timeout instead.
- **Crash-only:** atomic config writes (temp + rename); no lock files, no
  daemons, no cleanup on exit; every command safe to rerun; sync recomputes
  its diff from live remote state so interruption + rerun converges.
  Concurrent instances are safe.
- **Signals:** first Ctrl-C → print `Interrupted` immediately, abort in-flight
  requests, print state summary (e.g. `5 of 12 applied — rerun to converge`),
  exit; second Ctrl-C → instant exit; hard 2 s cap on all cleanup. REPL
  exception: Ctrl-C cancels the in-flight response, Ctrl-D/`/exit` quits.
- macOS case-insensitivity: sync detects case-only collisions and warns.

---

## 11. Chat REPL

- `chat -m "…"` = one-shot (streams to stdout in a TTY; `--json` returns the
  complete final message; piped stdin becomes the message when `-m` absent).
- `chat` with a TTY = REPL. Greeting states the exits: `/exit` or Ctrl-D to
  quit, Ctrl-C cancels a response.
- **Streaming default:** SSE (AI-SDK UIMessage stream format) parsed in the
  client layer; text deltas render live; tool-call events render as dim
  annotation lines; the finish event's `conversationId` is captured.
- Slash commands (minimal): `/exit`, `/new`, `/retry` (retry endpoint),
  `/id`, `/help`.
- `--conversation <id>` resumes any conversation; exit prints the ID + resume
  hint. `--no-stream` waits for complete responses.

---

## 12. MCP server

- `chatbase mcp` = stdio server via `@modelcontextprotocol/sdk`; exits on
  Ctrl-C or when the client closes stdin.
- **One tool per API operation (~34 as of 2026-08-06)**: chat/conversation
  tools (`send_message`, `list_conversations`, `get_conversation`,
  `list_messages`, `export_conversations`, `update_feedback`,
  `submit_tool_result`), source tools (7), agent tools (`list_agents`,
  `get_agent`, `create_agent`, `update_agent`, `delete_agent`, `clone_agent`,
  `train_agent`, ...), helpdesk tools (tickets/messages/teams/statuses), and
  `health`. Input schemas derived from the vendored OpenAPI spec — the third
  consumer of the single contract.
- **Tool names are frozen interface** (deprecation policy applies).
- Honest MCP annotations: `readOnlyHint` on reads, `destructiveHint` on
  deletes — Claude's permission prompts stay accurate.
- Auth/agent resolution identical to the CLI; `agentId` tool param optional
  when a default agent is configured. Chat via MCP is non-streaming.
- `mcp --setup` prints paste-ready snippets for Claude Desktop / Claude Code /
  Cursor. We never edit another program's config.

---

## 13. Sources sync

`chatbase sources sync <dir>` converges an agent's **file-type sources only**
to a local folder. Text/QnA/link sources are invisible to it — that scoping is
what makes delete-to-converge safe. (v1.1 candidate: QnA managed from a
structured `qna.yaml`; not v1.)

- **Stateless diff:** remote file sources keyed by `name` = relative path.
  Local-only → create (upload). Remote-only → delete. Both → compare local
  byte size to the API's `size` field; mismatch → re-upload. `--force`
  re-uploads everything (covers size-equal-but-changed; no local manifest, no
  hidden state).
- **Flow:** plan (`+3 ~2 −1`, git-push style) → confirm (TTY y/N; `--force`
  non-interactive; typed agent ID if deleting >50 %) → execute (concurrency
  4, progress per §10) → failures re-printed → exit non-zero if any op failed.
- `--dry-run` prints the plan only. Include/exclude globs from
  `chatbase.json` `sync` block (defaults: common document extensions,
  dotfiles excluded).

---

## 14. Future-proofing & stability policy

**Interface inventory** (changes only via deprecation): command names &
structure, flag names, exit codes, env var names, config file formats,
`--json` shapes, `--plain` columns, MCP tool names & schemas.

- Pretty output: **no stability promise** (documented: don't parse it).
- `--json`: inherits **API v2's compatibility contract** (it *is* the API
  response).
- `--plain`: **append-only columns** — existing columns never move or vanish
  within a major; new columns only at the end.
- **Deprecation mechanics:** old spelling keeps working + one-line stderr
  warning naming the replacement (oclif native); warning ships ≥1 minor
  before removal; removals only in majors. Migrated users see nothing.
- No catch-all subcommand; no prefix abbreviations; future aliases explicit
  and permanent.
- **No time bombs:** everything except API calls works offline (help,
  version, config, build — vendored spec). Only outbound call besides the API
  itself: the async npm update check (cached, never blocks, disabled by
  `CHATBASE_NO_UPDATE_NOTIFIER` or CI env).

---

## 15. Analytics & privacy

**None client-side.** No telemetry, no crash reporting service, no consent
dialogs. Instead every request carries
`User-Agent: chatbase-cli/<version> (<os>-<arch>; node/<ver>)[ mcp]`, giving
adoption/version/OS/MCP-vs-direct metrics **server-side in Axiom** from
requests users already chose to make. One transparent line in the README's
privacy note. Docs search analytics (Mintlify), npm download stats, and the
pre-filled issue template are the feedback channels.

---

## 16. Distribution

- **v1: npm** — `npm i -g chatbase` / `npx chatbase`. Audience is Node-heavy;
  accepted gap: non-Node users wait for v1.x.
- **v1.x: `oclif pack`** — platform tarballs with bundled Node, Homebrew
  formula, Windows installers (the Heroku pipeline; a config task, not an
  engineering one — part of why oclif was chosen).
- On-disk footprint: exactly three XDG dirs (config/state/cache). Uninstall
  documented at the bottom of install docs:
  `npm uninstall -g chatbase && rm -rf ~/.config/chatbase ~/.local/state/chatbase ~/.cache/chatbase`.

---

## 17. Testing & release

- **Client/unit:** Vitest + undici `MockAgent`; response fixtures **validated
  against the vendored spec's schemas in CI** so mocks can't lie.
- **Commands:** oclif test harness; snapshot tests on `--help` output (help
  text is interface); golden-file tests for pretty/plain/json rendering.
- **CI:** Biome, typecheck, tests, spec↔types sync check, startup-time check;
  matrix Node 20/22 × macOS/Linux/Windows.
- **E2E smoke:** small suite against a real test agent, key from repo
  secrets, **release tags only** (never fork PRs).
- **Release:** release-please (conventional commits → changelog → version
  PR); npm publish with provenance from CI; `oclif readme` regenerated in the
  same pipeline.

---

## 18. Private-repo dependencies

| Dependency | Needed for | Fallback |
|---|---|---|
| `GET /me` endpoint | `auth login` verification, `auth status` | lazy validation on first real command |
| Routes-only spec generator | `spec:refresh` (full 25-path spec) | **DONE 2026-08-06**: `scripts/generate-openapi-routes-only.ts` + `scripts/openapi-generator-stubs.ts` in the private repo (uncommitted — commit them there) |
| Pairing endpoints (`/cli/pairing`, `/cli/pairing/exchange`) + `/activate` page | v1.x browser login | v1 ships key-paste only |
| (Nice-to-have) automated private→docs spec sync | trustworthy public spec | manual refresh keeps working |

## 19. Open questions / risks

- `GET /me` response shape: v1 requires only workspace `{id, name}` + `plan`
  + credential type (full proposal in the OAuth design doc §2, private repo);
  confirm with the server team before implementation.
- File-upload specifics against `files.chatbase.co` (multipart contract) to be
  confirmed from the spec/handlers during implementation planning.
- The docs-repo spec is currently very stale (10 paths vs 25 in code as of
  2026-08-06 — missing sources, agents, and helpdesk groups entirely) — the
  CLI treats the private repo's generator as the only source of truth, and
  the routes-only generator fix (§18) is the top-priority private-repo
  dependency.
- API v2 is moving fast (agents + helpdesk groups landed within days of this
  spec). Re-run the endpoint survey (`grep "path: '" src/lib/api/v2/routes`)
  at the start of every implementation plan.
