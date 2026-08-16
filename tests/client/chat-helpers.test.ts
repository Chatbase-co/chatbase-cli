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

describe('fetchRecentHistory', () => {
    it('returns the last N messages oldest-first with text extracted and truncated', async () => {
        const { fetchRecentHistory } = await import(
            '../../src/client/chat-helpers.js'
        )
        mock.get('https://www.chatbase.co')
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1/messages',
                method: 'GET'
            })
            .reply(200, {
                data: [
                    {
                        id: 'm1',
                        role: 'user',
                        parts: [{ type: 'text', text: 'first   question' }]
                    },
                    {
                        id: 'm2',
                        role: 'assistant',
                        parts: [
                            { type: 'tool-call', toolName: 'x' },
                            { type: 'text', text: 'a'.repeat(300) }
                        ]
                    }
                ],
                pagination: { cursor: null, hasMore: false, total: 2 }
            })
        const history = await fetchRecentHistory({
            client: createApiClient({ apiKey: 'sk-test' }),
            agentId: 'agt_1',
            conversationId: 'conv_1'
        })
        expect(history).toHaveLength(2)
        expect(history[0]).toEqual({ role: 'user', text: 'first question' })
        expect(history[1].role).toBe('assistant')
        expect(history[1].text.length).toBe(201) // 200 chars + ellipsis
        expect(history[1].text.endsWith('…')).toBe(true)
    })
})
