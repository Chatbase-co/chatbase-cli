# Chatbase CLI — Launch & Ownership Checklist

Living checklist of the non-code items around shipping the CLI. Nothing here
blocks development; revisit before the public v1.0 launch.

_Last updated: 2026-08-09_

## npm — done

- [x] Package name `chatbase` claimed (placeholder 0.0.1 published by `dev-chatbase`, 2026-08-09)

## npm — backlog

- [ ] **Ask internally** whether anyone at Chatbase owns the dormant npm user
      `chatbase` (npmjs.com/~chatbase — display name "Chatbase", 0 packages).
      If yes, recover it via password reset on the old email.
- [ ] **File npm trademark ticket** (npmjs.com/support → user name dispute) to
      claim the dormant `chatbase` username/scope. Takes weeks; do it early.
      Draft text: we own the Chatbase trademark + the `chatbase` package
      (account `dev-chatbase`); the `chatbase` username is dormant with zero
      packages; request transfer.
- [ ] **Create the `chatbase-co` npm org** (free) — matches the GitHub org,
      gives an official scope, and is where the package should eventually live.
- [ ] **Add a second package owner** (`npm owner add <user> chatbase`) —
      lockout insurance before launch.
- [ ] **At Plan 4 (release pipeline):** transfer the package to the org
      (npmjs.com/package/chatbase → Settings → Transfer), manage access via
      teams, publish from GitHub Actions with trusted publishing (OIDC) +
      provenance.

## GitHub

- [x] Create `github.com/Chatbase-co/chatbase-cli` — **private** ✓ (created 2026-08-09)
- [ ] Before flipping public: LICENSE file (✓ committed 2026-08-10), SECURITY.md,
      issue templates, branch protection on main, CODEOWNERS
- [ ] **Public history strategy**: internal planning docs (docs/superpowers/,
      this checklist) live in git history and would be exposed by flipping the
      repo public. At launch, start the public history fresh: squash to a clean
      initial commit (or re-root the tree) WITHOUT docs/superpowers/ and
      launch-checklist.md, and keep those docs private-side from then on.
      gitignoring them beforehand does NOT scrub history — only this does.

## Decisions still open

- [ ] **`CHATBASE_API_URL` documentation stance**: the env override exists for
      local-server development and is visible in public source (Hyrum's law —
      users WILL find it). Before launch, either document it in a README
      "advanced" section with an explicit no-stability disclaimer, or leave it
      code-only knowing it's discoverable. `auth status` already warns whenever
      it's active.

- [ ] **License:** MIT recommended (what `gh`/oclif use); Apache-2.0 if legal
      wants the explicit patent grant. Confirm with legal before going public.
- [ ] **Launch timing vs unreleased endpoints:** the CLI's vendored spec and
      commands expose the agents + helpdesk endpoint groups, which are not yet
      customer-released. Go public only after those ship publicly, or strip
      them from the launch build.
- [ ] **Public docs gap:** chatbase.co/docs documents 10 of 25 API paths.
      Partly intentional (unreleased features) — decide what to publish when
      the API groups go GA, and whether to automate the private→docs spec sync.
- [ ] **File upload host undocumented:** `files.chatbase.co/api/v2` (the
      separate service for file-type source uploads) is not in the public
      docs or the OpenAPI spec. The CLI uses it for `sources create --file`
      and `sources sync`. Document it before launch, or customers have no
      way to upload files via the API.

## Private-repo work items (parallel track)

- [x] Routes-only OpenAPI generator — built 2026-08-06
      (`scripts/generate-openapi-routes-only.ts` + `openapi-generator-stubs.ts`
      in the `chatbase` repo; **still uncommitted there — commit them**)
- [ ] `GET /api/v2/me` endpoint (upgrades `auth login` verification; shape in
      the pairing-login design doc §3)
- [ ] Pairing login (design done: `chatbase` repo,
      `docs/superpowers/specs/2026-08-05-cli-pairing-login-design.md`; ~2–3
      days server-side)
