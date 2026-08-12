import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sendChat } from '../../src/client/chat-helpers.js'
import { createApiClient } from '../../src/client/client.js'

let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
})

afterEach(async () => {
    await mock.close()
})

describe('sendChat signal forwarding', () => {
    it('rejects with an AbortError and never hits the network when passed an already-aborted signal', async () => {
        // No interceptor registered for this path at all — if the abort
        // didn't short-circuit before dispatch, undici's MockAgent would
        // throw its own "no matching interceptor" error instead, which
        // would fail this assertion just as loudly.
        const client = createApiClient({ apiKey: 'sk-test' })
        const controller = new AbortController()
        controller.abort()
        await expect(
            sendChat({
                client,
                agentId: 'agt_1',
                message: 'hi',
                stream: true,
                signal: controller.signal,
                onText: () => {}
            })
        ).rejects.toMatchObject({ name: 'AbortError' })
    })
})
