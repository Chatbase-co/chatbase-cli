import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { retryChat } from '../../src/client/chat-helpers.js'
import { createApiClient } from '../../src/client/client.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

const sse = [
    'data: {"type":"text-delta","delta":"test"}\n\n',
    'data: {"type":"message-metadata","messageMetadata":{"conversationId":"c_1"}}\n\n',
    'data: [DONE]\n\n'
].join('')

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
})

afterEach(async () => {
    await mock.close()
})

describe('retryChat', () => {
    it('calls the retry endpoint', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/c_99/retry',
                method: 'POST'
            })
            .reply(200, sse, {
                headers: { 'content-type': 'text/event-stream' }
            })

        const client = createApiClient({ apiKey: 'sk-test' })
        const result = await retryChat({
            client,
            agentId: 'agt_1',
            conversationId: 'c_99',
            messageId: 'msg_99',
            stream: true,
            onText: () => {}
        })

        expect(result.conversationId).toBe('c_1')
    })
})
