# agent: type-design
# model: sonnet
# findings: 2

| # | Agent | Issue | Location | Symbol | Confidence |
|---|-------|-------|----------|--------|------------|
| 1 | type-design | `startPairing`/`pollExchange` cast the typed OpenAPI response to hand-written object literals instead of using the generated `CliPairingCreateResponse`/`CliPairingExchangeResponse` schema types, so a future field rename in the API contract compiles silently and fails only at runtime | `src/client/pairing.ts:18` | `startPairing` | 78 |
| 2 | type-design | `ChatResult` leaves `raw` and `conversationId` independently optional with no link to the `stream` flag that determines which is populated, forcing `chat/index.ts` and `chat/retry.ts` to each duplicate a runtime `if (!result.raw) throw ...` guard instead of the type ruling out the invalid combination | `src/client/chat-helpers.ts:24` | `ChatResult` | 76 |
