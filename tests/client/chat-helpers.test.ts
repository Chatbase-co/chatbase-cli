import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    extractText,
    sanitizeAgentText,
    sendChat
} from '../../src/client/chat-helpers.js'
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

describe('mid-stream failure signals', () => {
    it('throws after the stream drains when the server reports a mid-stream error, keeping the partial text', async () => {
        mock.get('https://www.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(
                200,
                [
                    'data: {"type":"text-delta","delta":"partial "}\n\n',
                    'data: {"type":"error","errorText":"Model exploded"}\n\n',
                    'data: [DONE]\n\n'
                ].join(''),
                { headers: { 'content-type': 'text/event-stream' } }
            )
        const client = createApiClient({ apiKey: 'sk-test' })
        let seen = ''
        await expect(
            sendChat({
                client,
                agentId: 'agt_1',
                message: 'hi',
                stream: true,
                onText: (t) => {
                    seen += t
                }
            })
        ).rejects.toThrow('Model exploded')
        expect(seen).toBe('partial ')
    })

    it('prints a stderr warning for a malformed stream chunk without failing the call', async () => {
        mock.get('https://www.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(
                200,
                [
                    'data: {oops\n\n',
                    'data: {"type":"text-delta","delta":"ok"}\n\n',
                    'data: [DONE]\n\n'
                ].join(''),
                { headers: { 'content-type': 'text/event-stream' } }
            )
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const client = createApiClient({ apiKey: 'sk-test' })
        let seen = ''
        await sendChat({
            client,
            agentId: 'agt_1',
            message: 'hi',
            stream: true,
            onText: (t) => {
                seen += t
            }
        })
        expect(seen).toBe('ok')
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toMatch(/malformed|unparseable/i)
        err.mockRestore()
    })
})

describe('assistant messageId tracking', () => {
    it('returns the messageId carried in the stream finish metadata', async () => {
        mock.get('https://www.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(
                200,
                [
                    'data: {"type":"text-delta","delta":"hi"}\n\n',
                    'data: {"type":"finish","messageMetadata":{"conversationId":"c_1","messageId":"m_42"}}\n\n',
                    'data: [DONE]\n\n'
                ].join(''),
                { headers: { 'content-type': 'text/event-stream' } }
            )
        const client = createApiClient({ apiKey: 'sk-test' })
        const result = await sendChat({
            client,
            agentId: 'agt_1',
            message: 'hi',
            stream: true,
            onText: () => {}
        })
        expect(result.messageId).toBe('m_42')
        expect(result.conversationId).toBe('c_1')
    })

    it('rejects with a clear message when a non-streaming response has no body', async () => {
        mock.get('https://www.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(200, '')
        const client = createApiClient({ apiKey: 'sk-test' })
        await expect(
            sendChat({
                client,
                agentId: 'agt_1',
                message: 'hi',
                stream: false,
                onText: () => {}
            })
        ).rejects.toThrow('Chat response was empty')
    })

    it('returns the messageId of a non-streaming response (data.id)', async () => {
        mock.get('https://www.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(200, {
                data: {
                    id: 'msg_7',
                    role: 'assistant',
                    parts: [{ type: 'text', text: 'hello' }],
                    metadata: {
                        userMessageId: 'u_1',
                        conversationId: 'c_1',
                        userId: null,
                        finishReason: 'stop',
                        usage: { credits: 1 }
                    }
                }
            })
        const client = createApiClient({ apiKey: 'sk-test' })
        const result = await sendChat({
            client,
            agentId: 'agt_1',
            message: 'hi',
            stream: false,
            onText: () => {}
        })
        expect(result.messageId).toBe('msg_7')
    })
})

describe('sanitizeAgentText', () => {
    it('strips ANSI/OSC control bytes, including an OSC 52 clipboard write', async () => {
        expect(sanitizeAgentText('\u001b]52;c;aGVsbG8=\u0007done')).toBe(
            ']52;c;aGVsbG8=done'
        )
        expect(sanitizeAgentText('a\u001b[31mred\u001b[0mb')).toBe(
            'a[31mred[0mb'
        )
        expect(sanitizeAgentText('\rspoof')).toBe('spoof')
    })

    it('keeps tabs and newlines', async () => {
        expect(sanitizeAgentText('line1\nline2\tend')).toBe('line1\nline2\tend')
    })

    it('is applied to streamed deltas and to extractText', async () => {
        mock.get('https://www.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(
                200,
                'data: {"type":"text-delta","delta":"x\\u001b[31my"}\n\ndata: [DONE]\n\n',
                { headers: { 'content-type': 'text/event-stream' } }
            )
        const client = createApiClient({ apiKey: 'sk-test' })
        let seen = ''
        await sendChat({
            client,
            agentId: 'agt_1',
            message: 'hi',
            stream: true,
            onText: (t) => {
                seen += t
            }
        })
        expect(seen).toBe('x[31my')

        expect(
            extractText({
                data: {
                    parts: [{ type: 'text', text: 'a\u001b[2Jb' }]
                } as never
            })
        ).toBe('a[2Jb')
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
        expect(history[0]).toEqual({
            id: 'm1',
            role: 'user',
            text: 'first question'
        })
        expect(history[1].role).toBe('assistant')
        expect(history[1].text.length).toBe(201) // 200 chars + ellipsis
        expect(history[1].text.endsWith('…')).toBe(true)
    })
})
