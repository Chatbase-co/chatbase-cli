# Chatbase CLI — Launch & Ownership Checklist

Living checklist of the non-code items around shipping the CLI. Nothing here
blocks development; revisit before the public v1.0 launch.

_Last updated: 2026-08-12_

## Release readiness (verified 2026-08-12)

- [x] 258 unit/integration tests green (35 files)
- [x] 5 e2e smoke tests written (skip cleanly when secrets absent; need
      one live `workflow_dispatch` run with real secrets before trusting)
- [x] CI: ubuntu/macos/windows × node 20/22 matrix with permissions +
      concurrency; build before test; spec:check; README drift check;
      startup budget (99ms vs 1000ms CI / 300ms product target)
- [x] Release pipeline: release-please config + publish workflow with
      provenance (needs NPM_TOKEN secret configured on GitHub)
- [x] README auto-generated command reference (39 commands via oclif readme)
- [x] LICENSE file committed (MIT)
- [x] Tarball: 73 files, 77KB; docs/superpowers NOT included (only
      bin/dist/spec/manifest ship); spec/openapi.json included (25 paths,
      no /internal routes, no real credentials in examples)
- [x] `repository` field in package.json set for provenance verification

## npm — done

- [x] Package name `chatbase` claimed (placeholder 0.0.1 published by
      `dev-chatbase`, 2026-08-09)

## npm — backlog (before launch)

- [ ] **Ask internally** whether anyone at Chatbase owns the dormant npm user
      `chatbase` (npmjs.com/~chatbase — display name "Chatbase", 0 packages).
      If yes, recover it via password reset on the old email.
- [ ] **File npm trademark ticket** (npmjs.com/support → user name dispute) to
      claim the dormant `chatbase` username/scope. Takes weeks; do it early.
- [ ] **Create the `chatbase-co` npm org** (free) — matches the GitHub org,
      gives an official scope, and is where the package should eventually live.
- [ ] **Add a second package owner** (`npm owner add <user> chatbase`) —
      lockout insurance before launch.
- [ ] **Configure NPM_TOKEN** (or trusted publishing) on the GitHub repo so
      the release workflow can publish. Transfer the package to the org once
      created.

## GitHub secrets (Settings → Secrets → Actions)

- [ ] **NPM_TOKEN** — npmjs.com → Access Tokens → Granular → Read+Write on
      `chatbase` package. Used by release.yml to publish.
- [ ] **CHATBASE_E2E_API_URL** — staging API base URL (e.g.
      `https://staging.chatbase.co/api/v2`). E2E tests run against staging,
      not production.
- [ ] **CHATBASE_E2E_API_KEY** — API key for the staging workspace.
- [ ] **CHATBASE_E2E_AGENT_ID** — a test agent in the staging workspace
      (create a dedicated one; don't use a customer agent).

## GitHub — before going public

- [x] Create `github.com/Chatbase-co/chatbase-cli` — **private** ✓ (2026-08-09)
- [ ] SECURITY.md (vulnerability reporting instructions)
- [ ] Issue templates (matching the pre-filled bug URL in base-command.ts)
- [ ] Branch protection on main (require CI, require review)
- [ ] CODEOWNERS
- [ ] **Public history strategy**: internal planning docs (docs/superpowers/,
      this checklist) live in git history. At launch, start the public history
      fresh: squash to a clean initial commit (or re-root the tree) WITHOUT
      docs/superpowers/ and launch-checklist.md. gitignoring them beforehand
      does NOT scrub history — only this does.

## Decisions still open

- [ ] **`CHATBASE_API_URL` documentation stance**: exists for local dev, visible
      in public source. Document in a README "advanced" section with a
      no-stability disclaimer, or leave code-only. `auth status` warns
      whenever it's active.
- [ ] **License:** MIT committed; Apache-2.0 if legal wants the patent grant.
      Confirm with legal before going public.
- [ ] **Launch timing vs unreleased endpoints:** the vendored spec + commands
      expose agents + helpdesk, which are not yet customer-released. Go public
      only after those ship, or strip them from the launch build.
- [ ] **Public docs gap:** chatbase.co/docs documents 10 of 25 API paths.
      Partly intentional (unreleased features) — decide what to publish when
      those go GA.

## Database / server-side (before launch)

- [ ] **RLS on new tables** — `cli_pairing_requests` and any other tables
      added by the pairing work must have Row-Level Security enabled and
      policies scoped to `account_id`. Supabase tables default to no RLS;
      a missing policy = publicly queryable via the PostgREST API.
- [ ] **Migration committed + applied** — the pairing work's schema changes
      (cli_pairing_requests table, api_keys source/expires_at/permissions
      columns) need their migration merged and run on staging + production
      before the CLI's browser login can work there.
- [ ] **Helpdesk permissions for Member + Support Associate roles** —
      HELPDESK_TICKETS_READ/WRITE/DELETE exist in permissions.ts and the
      CLI-grantable list, but no role includes them yet. Users can only
      grant scopes their own role has, so without this, support staff's
      CLI keys can never touch helpdesk endpoints. (ref:
      cmsq4zaks0hw80j089qm6pyjr)
- [ ] **chatlogs:write for every role** — all roles need CHATLOGS_WRITE so
      any user's CLI key can grant it (covers conversation-mutating
      operations like message feedback). Same RBAC rule as above: a scope
      missing from your role can never be granted to your key.

## Private-repo work items (parallel track)

- [x] Routes-only OpenAPI generator — built 2026-08-06 (uncommitted in the
      chatbase repo — commit them there)
- [ ] `GET /api/v2/me` endpoint (upgrades `auth login` verification)
- [ ] Pairing login (design done + being implemented in another session;
      scoped RBAC keys + 90-day expiry; CLI follow-up when it merges:
      spec refresh 25→28 paths + browser-login path + scopes/expiry in
      auth status)

## Post-v1 backlog

- [ ] MCP server mode (`chatbase mcp`) — descoped from v1 (2026-08-11);
      design + plan written and ready in Plan 4 Tasks 1-3
- [ ] Homebrew distribution via `oclif pack`
- [ ] `--all` pagination loop cap (harden against cycling cursors)
- [ ] `?name=` query filter on GET /agents (simplifies --agent-name to
      one request instead of fetching all pages)
- [ ] Emoji polish for status glyphs and success/error lines
- [ ] `chatbase docs` command (add back when CLI docs pages exist)
- [ ] Tool-call event rendering in chat streams (dim annotation lines)
- [ ] `as never` body casts — replace with proper typed helpers (10 commands)
- [ ] Man pages (revisit on user demand)
