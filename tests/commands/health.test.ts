import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Health from '../../src/commands/health.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
})

describe('chatbase health', () => {
    it('prints ✓ and the API status on success', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/health', method: 'GET' })
            .reply(200, { status: 'ok', timestamp: 1 })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Health.run([], process.cwd())
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'API is up'
        )
    })

    it('--json prints the raw response to stdout', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/health', method: 'GET' })
            .reply(200, { status: 'ok', timestamp: 42 })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await Health.run(['--json'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual({ status: 'ok', timestamp: 42 })
    })

    it('exits 1 with a rendered ApiError on failure', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/health', method: 'GET' })
            .reply(500, { error: { code: 'INTERNAL', message: 'down' } })
        mock.get(BASE)
            .intercept({ path: '/api/v2/health', method: 'GET' })
            .reply(500, { error: { code: 'INTERNAL', message: 'down' } })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(Health.run([], process.cwd())).rejects.toMatchObject({
            oclif: { exit: 1 }
        })
    })
})
