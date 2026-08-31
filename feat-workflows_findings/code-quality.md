# agent: code-quality
# model: sonnet
# findings: 2

| # | Agent | Issue | Location | Symbol | Confidence |
|---|-------|-------|----------|--------|------------|
| 1 | code-quality | Interactive `/retry` sends a literal `messageId: 'last'` to the `/retry` endpoint, but the OpenAPI contract (`RetryRequest.messageId`) documents it as a real message ID (`minLength: 1`, example `"msg-abc123"`) with no sentinel value — nothing in spec/openapi.json, tests, or the launch-checklist backlog confirms the server special-cases this string, so every `/retry` in the chat REPL likely 404s/validation-fails | `src/commands/chat/index.ts:201` | `runInteractive` | 80 |
| 2 | code-quality | The deduped `readStdinToEnd()` now `.trim()`s its output and is used for the `@-` branch of `resolveInput`, silently changing behavior: previously `@-` stdin content was returned verbatim (matching `@file`, which still uses untrimmed `fs.readFileSync`); now `chatbase sources create --content @- --type text` (and any `--data @-` / `-f` piped input) has leading/trailing whitespace silently stripped, diverging from `@file`'s fidelity and from this codebase's pre-refactor behavior | `src/base/body-input.ts:23` | `resolveInput` | 78 |
