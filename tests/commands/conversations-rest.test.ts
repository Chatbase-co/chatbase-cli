import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversationsExport from '../../src/commands/conversations/export.js'
import ConversationsGet from '../../src/commands/conversations/get.js'
import MessagesFeedback from '../../src/commands/messages/feedback.js'
import MessagesList from '../../src/commands/messages/list.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

function bodyText(body: unknown): string {
    if (body == null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
    return String(body)
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-conv-rest-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase conversations get', () => {
    const getResponse = {
        data: {
            id: 'conv_1',
            title: 'Refunds',
            status: 'ongoing',
            createdAt: 1785542400,
            updatedAt: 1785628800,
            userId: 'u1',
            messages: [
                {
                    id: 'msg_1',
                    role: 'user',
                    parts: [{ type: 'text', text: 'hi' }]
                }
            ]
        },
        pagination: { cursor: null, hasMore: false, total: 1 }
    }

    it('renders a plain row matching the conversations-list columns', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1',
                method: 'GET'
            })
            .reply(200, getResponse)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await ConversationsGet.run(
            ['--conversation', 'conv_1', '--plain'],
            process.cwd()
        )
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'conv_1\tRefunds\tongoing\t1785542400\t1785628800'
        )
    })

    it('--json emits the raw response envelope, nested messages included', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1',
                method: 'GET'
            })
            .reply(200, getResponse)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await ConversationsGet.run(
            ['--conversation', 'conv_1', '--json'],
            process.cwd()
        )
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(getResponse)
    })
})

describe('chatbase conversations export', () => {
    const exportResponse = {
        data: [
            {
                id: 'conv_1',
                title: 'Refunds',
                createdAt: 1785542400,
                updatedAt: 1785628800,
                userId: null,
                source: 'API',
                status: 'ongoing',
                messages: []
            }
        ],
        pagination: { cursor: null, hasMore: false, total: 1 }
    }

    it('streams the raw export JSON to stdout by default', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/export',
                method: 'GET'
            })
            .reply(200, exportResponse)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await ConversationsExport.run([], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(exportResponse)
    })

    it('is JSON-shaped even without --json (pretty mode = same JSON)', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/export',
                method: 'GET'
            })
            .reply(200, exportResponse)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true
        })
        await ConversationsExport.run([], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(exportResponse)
    })

    it('-o writes the export JSON to a file instead of stdout', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/export',
                method: 'GET'
            })
            .reply(200, exportResponse)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const tmpFile = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), 'cb-export-')),
            'out.json'
        )
        await ConversationsExport.run(['-o', tmpFile], process.cwd())
        expect(out.mock.calls.length).toBe(0)
        expect(JSON.parse(fs.readFileSync(tmpFile, 'utf8'))).toEqual(
            exportResponse
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            tmpFile
        )
    })

    it('passes --cursor and --limit through as query params', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/export',
                method: 'GET',
                query: { cursor: 'cur_2', limit: '5' }
            })
            .reply(200, exportResponse)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await ConversationsExport.run(
            ['--cursor', 'cur_2', '--limit', '5'],
            process.cwd()
        )
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(exportResponse)
    })
})

describe('chatbase messages list', () => {
    const page1 = {
        data: [
            {
                id: 'msg_1',
                role: 'user',
                parts: [{ type: 'text', text: 'hi' }],
                createdAt: 1785542400
            }
        ],
        pagination: { cursor: 'cur_2', hasMore: true, total: 2 }
    }
    const page2 = {
        data: [
            {
                id: 'msg_2',
                role: 'assistant',
                parts: [{ type: 'text', text: 'hello' }],
                createdAt: 1785542500
            }
        ],
        pagination: { cursor: null, hasMore: false, total: 2 }
    }

    it('renders rows with columns id, role, createdAt', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1/messages',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await MessagesList.run(
            ['--conversation', 'conv_1', '--plain'],
            process.cwd()
        )
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'msg_1\tuser\t1785542400'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '--cursor cur_2'
        )
    })

    it('--all follows pagination to the end', async () => {
        const pool = mock.get(BASE)
        pool.intercept({
            path: '/api/v2/agents/agt_1/conversations/conv_1/messages',
            method: 'GET'
        }).reply(200, page1)
        pool.intercept({
            path: '/api/v2/agents/agt_1/conversations/conv_1/messages',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, page2)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await MessagesList.run(
            ['--conversation', 'conv_1', '--plain', '--all'],
            process.cwd()
        )
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('msg_1')
        expect(printed).toContain('msg_2')
    })

    it('--json emits the raw API envelope', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1/messages',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await MessagesList.run(
            ['--conversation', 'conv_1', '--json'],
            process.cwd()
        )
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(page1)
    })
})

describe('positional IDs (match agents/sources get ergonomics)', () => {
    it('conversations get accepts the conversation ID positionally', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_9',
                method: 'GET'
            })
            .reply(200, {
                data: {
                    id: 'conv_9',
                    title: 'T',
                    status: 'ongoing',
                    createdAt: 1,
                    updatedAt: 2
                },
                pagination: { cursor: null, hasMore: false }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsGet.run(['conv_9', '-a', 'agt_1'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'conv_9'
        )
    })

    it('messages feedback accepts the message ID positionally', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1/messages/msg_7/feedback',
                method: 'PATCH'
            })
            .reply(200, (o) => {
                sent =
                    o.body instanceof Uint8Array
                        ? Buffer.from(o.body).toString('utf8')
                        : String(o.body)
                return { data: { ok: true } }
            })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await MessagesFeedback.run(
            [
                'msg_7',
                '--conversation',
                'conv_1',
                '--rating',
                'positive',
                '-a',
                'agt_1'
            ],
            process.cwd()
        )
        expect(JSON.parse(sent)).toEqual({ feedback: 'positive' })
    })
})

describe('chatbase messages feedback', () => {
    it('maps --rating clear to a PATCH body of {"feedback":null}', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1/messages/msg_1/feedback',
                method: 'PATCH'
            })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return {
                    data: {
                        id: 'msg_1',
                        role: 'assistant',
                        parts: [],
                        feedback: null
                    }
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await MessagesFeedback.run(
            [
                '--conversation',
                'conv_1',
                '--message',
                'msg_1',
                '--rating',
                'clear'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({ feedback: null })
        expect(err.mock.calls.join('')).toContain('msg_1')
    })

    it('maps --rating positive to a PATCH body of {"feedback":"positive"}', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1/messages/msg_1/feedback',
                method: 'PATCH'
            })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return {
                    data: {
                        id: 'msg_1',
                        role: 'assistant',
                        parts: [],
                        feedback: 'positive'
                    }
                }
            })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await MessagesFeedback.run(
            [
                '--conversation',
                'conv_1',
                '--message',
                'msg_1',
                '--rating',
                'positive'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({ feedback: 'positive' })
    })
})
