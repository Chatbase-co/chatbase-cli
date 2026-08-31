# PR #3 (feat/workflows) — QA & fix session record

Everything that happened across the QA/fix sessions of 2026-08-16 → 18, kept
for answering PR review comments. Untracked on purpose — this never ships.

- **PR:** https://github.com/Chatbase-co/chatbase-cli/pull/3
- **Full QA report (artifact, always current):**
  https://claude.ai/code/artifact/b3782168-bfa6-498d-8f52-652e9ea06734
- **Backend handoff design doc:** `~/work/chatbase/api-v2-fixes-design.md`
  (A1/A9/A10 fixes, A2 investigation, D1–D3 decisions, P1–P3 polish)

## Commits on feat/workflows (in order, all CI-green)

| SHA | What |
|---|---|
| `dc3ebc4` | Main batch: all 24 code-review issues + QA fixes B1–B6, C1–C9 (325 tests) |
| `6f3d761` | #26 sync convergence: spec refresh + `originalSize ?? size` predicate in `src/sync/diff.ts` |
| `81fe469` | Windows CI: statSync-through-file throws ENOENT on win32, ENOTDIR on POSIX (test fix) |
| `59aa796` | `ExchangeAttempt` result-object refactor in `pairing.ts`; `ts()` → `formatTimestamp` |
| `b362288` | B7 positional ticket numbers (messages/reply), B8 `--customer-email/--customer-name` on tickets create + `--data` field lists, B9 shadow warning on `config set agent` |
| `3b12b18` | C10 `command_not_found` hook (chat "msg" → suggests `-m`), C11 `agents train` falls back to default agent |
| `e171b2a` | docs: launch-checklist refresh (Now section, shipped items marked) |
| `12a68af` | refactor: `...(cond && {...})` body construction in tickets create |
| `43aa708` | test: pin FORCE_COLOR/NO_COLOR/TERM in `tests/setup.ts` (suite was env-dependent) |
| `44c5973` | refactor: drop `pages.at(-1)!` in fetchAllPages → lint now zero warnings |

Full commit link format: `https://github.com/Chatbase-co/chatbase-cli/commit/<sha>`

## Finding → fix map (for review comments)

- **B1** uploads ignore CHATBASE_API_URL → *decision: warn, not derive* →
  `filesHostMismatchWarning()` in `src/client/files.ts` (dc3ebc4)
- **B2** positional IDs on `conversations get` / `messages feedback` (dc3ebc4)
- **B3** `oclif.topics` entries for agents/sources in package.json (dc3ebc4)
- **B4** qna requires `--name` client-side, exit 2 (dc3ebc4)
- **B5** `--verbose` on the upload path (dc3ebc4)
- **B6** `DEFAULT_INCLUDE` → pdf/txt/docx/doc/json only; 50-byte-min/20MB-max
  skip-with-note (*decision: trim only, no API ask*) (dc3ebc4)
- **B7/B8/B9** tickets positionals, customer flags, config shadow warning (b362288)
- **C1–C9** printDetail views, formatEpochSeconds, 'No results.', config
  clear via `agent ''`, sources summary flatten, retry description warning,
  auth status exit 1 (*decision: include exit-code change*), bodyFieldFlags
  scoping (why `-f` left most READMEs), sync duplicate-failures dedup (dc3ebc4)
- **C10/C11** chat -m hint hook + train default agent (3b12b18)
- **#26/#7** sync convergence via backend `FileMetadata.originalSize`
  (backend shipped it; CLI predicate `r.originalSize ?? r.size`) (6f3d761)
- **Pairing #24/#18** transient-network resilience via two-arg `.then()`
  result object; generated schema types keep casts honest (dc3ebc4 + 59aa796)

## Key design decisions (user-approved, with why)

- B1: **warn instead of derive** files host — deriving risked silently
  pointing uploads at a host that doesn't serve them.
- B6: **trim defaults only** — no API ask for .md support.
- Retry semantics: description explicitly warns retry **discards** the
  message and everything after it.
- `chat` message must be `-m`/stdin/REPL — positional is impossible because
  `chat` is also a topic (`chat retry`); the hook explains instead.
- oclif hook quirk: `command_not_found` receives `id` **colon-joined**
  (`chat:hello there`) — tests cover both shapes.
- zsh gotcha that caused a fake regression: unquoted `$VAR` does NOT
  word-split in zsh → sent `-a " agt…"` with a leading space.
- Size-based sync diff cannot detect same-byte-length edits (84→84 bytes
  looked unchanged; 84→107 detected fine). Known limitation, not a bug.

## Backend findings (out of CLI scope; design doc has full detail)

A1 train-with-0-sources 500 (repro'd on localhost, mechanism diagnosed in
`train-agent.handler.ts`) · A2 Vercel preview upload 500 (Railway staging
works — env issue) · A3 delete kill-switch (endpoint verified healthy via
localhost: delete→restore→delete round-trip) · A4 Enterprise 4-agent limit ·
A5 qna name contract · A6 scope naming · A7 `chatlogs:delete` dead scope
(**conclusively proven** in round 4: scope granted, `api DELETE
…/conversations/{id}` → NOT_FOUND) · A8 upload type/size limits ·
A9 200-empty lists for nonexistent agents · A10 `POST /sources` 500 for
nonexistent agent (create-side sibling of A9 — folds into the same fix)

## Permission QA (4 rounds, 0 enforcement failures)

1. All permissions — full surface pass.
2. Read-only — 11/11 reads pass, 14/14 writes blocked incl. `api POST`.
3. Custom asymmetric — write-without-read enforced exactly.
4. Restricted (`agents:read, sources:read, chatlogs:delete,
   helpdesk_tickets:read`) — 11/11 allowed, 16/16 denied. Confirmed:
   authz→existence→feature-flag ordering (403 before 404, 403 before the
   A3 503), sync `--dry-run` works under sources:read alone, helpdesk
   lookups covered by helpdesk_tickets:read.

Pairing negative paths: **deny verified** (instant `PAIRING_DENIED`, exit 1,
stored key untouched). Untested: expiry (~15 min), wrong-code (browser-side).

## Current state / gotchas for next session

- **Stored key is the restricted round-4 key `…403e`** — writes 403 until
  re-pairing full access (`chatbase auth login --browser` vs the preview).
- Test env: `CHATBASE_API_URL=https://chatbase-git-feat-cli-pairing-login.chatbase.fyi/api/v2`
  and **always** `CHATBASE_FILES_URL=https://api-staging-5ef3.up.railway.app/api/v2`
  for uploads (else keys leak to production files host — B1 warning fires).
- Test leftovers: sweep3 sources on agent "API Test" (EGjv9gat4JRS1eWrOasQA),
  closed tickets 772/773/774 on "whatsapp" (XBaqT0K1pXO8yHyNCIbdN),
  test conversations (no delete endpoint exists — A7).
- Default agent in user config: whatsapp. `config set timeout 30000` wrote
  an explicit user-config value (was default before) — harmless.
- Backend repo: `feat/cli-pairing-login` not yet on main; PR #4586 (generator
  scripts + tintedGrayscale) merged per user; local uncommitted edits there:
  `next.config.js`, `disabled-endpoints.ts` (deletion enabled locally).
- Remaining CLI-repo work is process only: merge PR #3, npm/GitHub launch
  checklist (`docs/launch-checklist.md` "Now" section), and a
  `spec:refresh` when backend fixes land.
