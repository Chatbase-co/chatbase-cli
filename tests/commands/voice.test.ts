import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceStart from '../../src/commands/voice/start.js'

const BASE = 'https://www.chatbase.co'
const PATH = '/api/v2/agents/agt_1/voice/sessions'
let mock: MockAgent

function bodyText(body: unknown): string {
    if (body == null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
    return String(body)
}

/** Pretty output only renders on a TTY; restore() puts the descriptor back. */
function stubStdoutTTY(): { restore: () => void } {
    const original = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        configurable: true
    })
    return {
        restore: () => {
            if (original) {
                Object.defineProperty(process.stdout, 'isTTY', original)
            } else {
                delete (process.stdout as { isTTY?: boolean }).isTTY
            }
        }
    }
}

// Long enough that the pretty-mode abbreviation has something to cut.
const TOKEN = `eyJhbGciOiJIUzI1NiJ9.${'x'.repeat(120)}.sig`

const session = {
    participantToken: TOKEN,
    sessionId: 'vs_1',
    roomName: 'chatbot-agt_1-conv_1-vs_1',
    maxDurationSeconds: 600,
    conversationId: 'conv_1',
    userId: 'user_42'
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-voice-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase voice start', () => {
    it('POSTs the default timezone and renders a plain row with the full token', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return { data: session }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await VoiceStart.run(['--plain'], process.cwd())
        expect(JSON.parse(sentBody)).toEqual({ timezone: 'UTC' })
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            `vs_1\tconv_1\tuser_42\tchatbot-agt_1-conv_1-vs_1\t600\t${TOKEN}`
        )
    })

    it('sends conversationId, userId and timezone when the flags are given', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return { data: session }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await VoiceStart.run(
            [
                '--conversation',
                'conv_1',
                '--user',
                'user_42',
                '--timezone',
                'Europe/Paris',
                '--plain'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            timezone: 'Europe/Paris',
            conversationId: 'conv_1',
            userId: 'user_42'
        })
    })

    it('passes the raw response through with --json', async () => {
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, { data: session })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await VoiceStart.run(['--json'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(JSON.parse(printed)).toEqual({ data: session })
    })

    it('abbreviates the participant token in the pretty detail view', async () => {
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(200, { data: session })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const tty = stubStdoutTTY()
        try {
            await VoiceStart.run([], process.cwd())
        } finally {
            tty.restore()
        }
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain(
            `${TOKEN.slice(0, 16)}… (${TOKEN.length} chars)`
        )
        expect(printed).not.toContain(TOKEN)
    })

    it('surfaces an API error', async () => {
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(403, {
                error: {
                    code: 'VOICE_NOT_AVAILABLE',
                    message: 'Voice mode is not available on this plan'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(VoiceStart.run([], process.cwd())).rejects.toMatchObject({
            oclif: { exit: 1 }
        })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'Voice mode is not available'
        )
    })
})
