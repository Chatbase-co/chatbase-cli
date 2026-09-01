import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { pollExchange } from '../../src/client/pairing.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
})

afterEach(async () => {
    await mock.close()
})

it('keeps polling through a transient network failure instead of aborting the login', async () => {
    // First poll: network-level failure (connection reset). Second: success.
    mock.get(BASE)
        .intercept({ path: '/api/cli-pairing/exchange', method: 'POST' })
        .replyWithError(new Error('socket hang up'))
    mock.get(BASE)
        .intercept({ path: '/api/cli-pairing/exchange', method: 'POST' })
        .reply(200, {
            api_key: 'sk-after-blip',
            workspace: { id: 'w1', name: 'Acme' }
        })

    const result = await pollExchange('dev_1', {
        intervalMs: 10,
        timeoutMs: 5000
    })
    expect(result.apiKey).toBe('sk-after-blip')
})

it('still gives up at the deadline when the network keeps failing', async () => {
    mock.get(BASE)
        .intercept({ path: '/api/cli-pairing/exchange', method: 'POST' })
        .replyWithError(new Error('socket hang up'))
        .persist()

    await expect(
        pollExchange('dev_1', { intervalMs: 10, timeoutMs: 60 })
    ).rejects.toThrow(/expired/i)
})
