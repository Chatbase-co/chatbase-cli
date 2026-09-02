import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversationsToolResult from '../../src/commands/conversations/tool-result.js'

const BASE = 'https://www.chatbase.co'
const PATH = '/api/v2/agents/agt_1/conversations/conv_1/tool-result'
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
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-toolresult-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase conversations tool-result', () => {
    it('sends toolCallId and JSON --output parsed as a value', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return { data: { success: true } }
            })
        await ConversationsToolResult.run(
            [
                'conv_1',
                '--tool-call-id',
                'tc_1',
                '--output',
                '{"temperature": 72}',
                '--quiet'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            toolCallId: 'tc_1',
            output: { temperature: 72 }
        })
    })

    it('sends non-JSON --output as a plain string', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return { data: { success: true } }
            })
        await ConversationsToolResult.run(
            [
                'conv_1',
                '--tool-call-id',
                'tc_1',
                '--output',
                'sunny',
                '--quiet'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            toolCallId: 'tc_1',
            output: 'sunny'
        })
    })

    it('resolves --output @file indirection', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-toolout-'))
        const file = path.join(dir, 'result.json')
        fs.writeFileSync(file, '{"temperature": 72}')
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return { data: { success: true } }
            })
        await ConversationsToolResult.run(
            [
                'conv_1',
                '--tool-call-id',
                'tc_1',
                '--output',
                `@${file}`,
                '--quiet'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            toolCallId: 'tc_1',
            output: { temperature: 72 }
        })
    })

    it('omits output entirely when --output is not passed', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return { data: { success: true } }
            })
        await ConversationsToolResult.run(
            ['conv_1', '--tool-call-id', 'tc_1', '--quiet'],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({ toolCallId: 'tc_1' })
    })

    it('--json emits the raw response', async () => {
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, { data: { success: true } })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await ConversationsToolResult.run(
            ['conv_1', '--tool-call-id', 'tc_1', '--json'],
            process.cwd()
        )
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual({ data: { success: true } })
    })

    it('accepts --conversation as an alternative to the positional', async () => {
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, { data: { success: true } })
        await ConversationsToolResult.run(
            ['--conversation', 'conv_1', '--tool-call-id', 'tc_1', '--quiet'],
            process.cwd()
        )
    })

    it('rejects a missing conversation ID with usage guidance', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsToolResult.run(
                ['--tool-call-id', 'tc_1'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'Missing conversation ID'
        )
    })

    it('rejects passing the conversation both positionally and via flag', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsToolResult.run(
                [
                    'conv_1',
                    '--conversation',
                    'conv_2',
                    '--tool-call-id',
                    'tc_1'
                ],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'not both'
        )
    })

    it('surfaces an API 404 for an unknown tool call', async () => {
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(404, {
                error: {
                    code: 'TOOL_CALL_NOT_FOUND',
                    message: 'Tool call not found'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsToolResult.run(
                ['conv_1', '--tool-call-id', 'tc_missing'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'Tool call not found'
        )
    })
})
