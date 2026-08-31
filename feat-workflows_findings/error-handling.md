# agent: error-handling
# model: sonnet
# findings: 4

| # | Agent | Issue | Location | Symbol | Confidence |
|---|-------|-------|----------|--------|------------|
| 1 | error-handling | Fetching --resume conversation history swallows every error with an empty catch and zero user feedback (no note/log), so a failed fetch looks identical to "no history" | `src/commands/chat/index.ts:145` | `runInteractive` | 82 |
| 2 | error-handling | assertDirReadable catches all fs.statSync errors (EACCES, ENOTDIR, etc.) and reports them all as "Directory not found", misdiagnosing e.g. permission errors on an existing directory | `src/commands/sources/sync.ts:31` | `assertDirReadable` | 76 |
| 3 | error-handling | The retry loop's inter-attempt sleep is not wired to the newly-added per-call abort signal, so Ctrl-C during a chat command's 429 backoff wait (up to 60s per x-ratelimit-reset) is not honored until the wait finishes — breaking the documented "Ctrl-C cancels one chat response" contract this diff introduces | `src/client/client.ts:130` | `makeFetch` | 78 |
| 4 | error-handling | pollExchange has no try/catch around the exchange POST call in its polling loop, so any transient network failure during the (potentially multi-minute) browser-login wait immediately aborts the whole pairing flow with an "unexpected error" instead of continuing to poll to the deadline | `src/client/pairing.ts:61` | `pollExchange` | 76 |
