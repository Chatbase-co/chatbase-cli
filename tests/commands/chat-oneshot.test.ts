import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Chat from '../../src/commands/chat.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

function bodyText(body: unknown): string {
    if (body == null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
    return String(body)
}

/** SSE body in the AI-SDK UIMessage stream protocol the API emits. */
const sse = [
    'data: {"type":"text-delta","delta":"Hi "}\n\n',
    'data: {"type":"text-delta","delta":"there"}\n\n',
    'data: {"type":"message-metadata","messageMetadata":{"conversationId":"c_77"}}\n\n',
    'data: [DONE]\n\n'
].join('')

const chatResponse = {
    data: {
        id: 'msg_1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi there' }],
        metadata: {
            userMessageId: 'u_1',
            conversationId: 'c_1',
            userId: null,
            finishReason: 'stop',
            usage: { credits: 1 }
        }
    }
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-chat-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

/** A non-TTY stdin that yields `text` and then ends — simulates a pipe. */
function stubPipedStdin(text: string) {
    const stdin = Readable.from([text]) as unknown as NodeJS.ReadStream & {
        fd: 0
    }
    Object.defineProperty(stdin, 'isTTY', { value: false })
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)
}

/** A TTY stdin the test can write scripted lines/bytes to, for driving the
 * interactive REPL that a TTY-with-no-message triggers in chat.ts. */
function stubInteractiveTTY(): PassThrough {
    const stdin = new PassThrough()
    Object.defineProperty(stdin, 'isTTY', { value: true })
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(
        stdin as unknown as NodeJS.ReadStream & { fd: 0 }
    )
    return stdin
}

describe('chatbase chat (one-shot)', () => {
    it('streams tokens to stdout in order and prints the conversation hint to stderr', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(200, sse, {
                headers: { 'content-type': 'text/event-stream' }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Chat.run(['-m', 'hello'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'Hi there\n'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'c_77'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'chatbase chat -a agt_1 --conversation c_77'
        )
    })

    it('sends { message, stream } (not a messages[] array) as the request body', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(
                200,
                (o) => {
                    sent = bodyText(o.body)
                    return sse
                },
                { headers: { 'content-type': 'text/event-stream' } }
            )
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Chat.run(['-m', 'hello'], process.cwd())
        expect(JSON.parse(sent)).toEqual({ message: 'hello', stream: true })
    })

    it('--conversation forwards conversationId in the request body', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(
                200,
                (o) => {
                    sent = bodyText(o.body)
                    return sse
                },
                { headers: { 'content-type': 'text/event-stream' } }
            )
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Chat.run(
            ['-m', 'hello', '--conversation', 'conv_9'],
            process.cwd()
        )
        expect(JSON.parse(sent)).toMatchObject({ conversationId: 'conv_9' })
    })

    it('--json disables streaming and prints the raw { data: ChatResponse } envelope', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(200, (o) => {
                sent = bodyText(o.body)
                return chatResponse
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Chat.run(['-m', 'hello', '--json'], process.cwd())
        expect(JSON.parse(sent)).toMatchObject({ stream: false })
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(chatResponse)
        // --json is the machine-consumption path: no decorative hint mixed in.
        expect(err.mock.calls.length).toBe(0)
    })

    it('--no-stream waits for the full response and prints the text once', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(200, chatResponse)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Chat.run(['-m', 'hello', '--no-stream'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0]))).toEqual(['Hi there\n'])
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'c_1'
        )
    })

    it('reads the message from piped stdin when -m is absent', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(
                200,
                (o) => {
                    expect(JSON.parse(bodyText(o.body))).toMatchObject({
                        message: 'explain this'
                    })
                    return sse
                },
                { headers: { 'content-type': 'text/event-stream' } }
            )
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        stubPipedStdin('explain this\n')
        await Chat.run([], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'Hi there\n'
        )
    })

    it('enters the interactive REPL when stdin is a TTY and no -m is given, and prints the resume hint on exit', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/chat', method: 'POST' })
            .reply(200, sse, {
                headers: { 'content-type': 'text/event-stream' }
            })
        const stdin = stubInteractiveTTY()
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        setImmediate(() => {
            stdin.write('hello\n')
            setTimeout(() => stdin.write('/exit\n'), 20)
        })
        await Chat.run([], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'Hi there'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'Type /exit or press Ctrl-D to quit'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'chatbase chat -a agt_1 --conversation c_77'
        )
    })

    it('the REPL never receives the -m flag path and closes cleanly on Ctrl-D (input end) with no messages sent', async () => {
        const stdin = stubInteractiveTTY()
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        setImmediate(() => stdin.end())
        await expect(Chat.run([], process.cwd())).resolves.toBeUndefined()
    })
})
