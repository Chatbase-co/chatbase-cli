import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Runs against the REAL Chatbase API using the REAL built binary. Only
// enabled when both env vars are present — locally that means it's skipped
// (not failed) unless a developer opts in; in CI it's wired to run only on
// published releases and manual dispatch, where the two secrets are set.
const KEY = process.env.CHATBASE_E2E_API_KEY
const AGENT = process.env.CHATBASE_E2E_AGENT_ID

const run = (args: string[]) =>
    execFileSync('node', ['bin/run.js', ...args], {
        encoding: 'utf8',
        env: { ...process.env, CHATBASE_API_KEY: KEY, CHATBASE_AGENT_ID: AGENT }
    })

describe.skipIf(!KEY || !AGENT)('e2e smoke', () => {
    it('health', () => {
        expect(() => run(['health'])).not.toThrow()
    })

    it('agents list --json returns this agent', () => {
        const res = JSON.parse(run(['agents', 'list', '--json']))
        expect(res.data.some((a: { id: string }) => a.id === AGENT)).toBe(true)
    })

    it('sources list works', () => {
        // The agent may or may not have sources — just confirm the call
        // succeeds against the real API.
        expect(() => run(['sources', 'list', '--json'])).not.toThrow()
    })

    it('chat one-shot answers', () => {
        const out = run([
            'chat',
            '-m',
            'Reply with the word pong.',
            '--no-stream'
        ])
        expect(out.length).toBeGreaterThan(0)
    })

    it('conversations list sees the chat', () => {
        const res = JSON.parse(run(['conversations', 'list', '--json']))
        expect(res.data.length).toBeGreaterThan(0)
    })
})
