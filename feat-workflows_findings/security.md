# agent: security
# model: sonnet
# findings: 1

| # | Agent | Issue | Location | Symbol | Confidence |
|---|-------|-------|----------|--------|------------|
| 1 | security | Streamed/non-streamed chat and resume-history text is written to stdout with `process.stdout.write`/`this.note` with no ANSI/OSC escape-sequence stripping, so agent-sourced content (which can include attacker-influenced knowledge-base/web content) can inject terminal control sequences (e.g. OSC 52 clipboard write, cursor moves, hidden text) into the user's terminal | `src/commands/chat/index.ts:95` | `run` | 78 |

