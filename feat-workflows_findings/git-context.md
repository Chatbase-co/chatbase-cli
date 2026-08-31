# agent: git-context
# model: sonnet
# findings: 1

| # | Agent | Issue | Location | Symbol | Confidence |
|---|-------|-------|----------|--------|------------|
| 1 | git-context | The `--resume` flag added in this PR (commit 847e53c) is only wired into the TTY-REPL branch of `run()`; combining it with `-m`/piped stdin silently sends the message with no history replay and no warning that `--resume` was ignored | `src/commands/chat/index.ts:129` | `runInteractive` | 78 |
