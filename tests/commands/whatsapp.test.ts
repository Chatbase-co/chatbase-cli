import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WhatsappSendTemplate from '../../src/commands/whatsapp/send-template.js'
import WhatsappTemplates from '../../src/commands/whatsapp/templates.js'

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
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-whatsapp-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

const template = {
    id: 'tpl_1',
    name: 'order_update',
    language: 'en_US',
    category: 'UTILITY',
    status: 'APPROVED',
    parameterFormat: 'POSITIONAL',
    wabaId: 'waba_1',
    variables: { header: ['1'], body: ['1', '2'] },
    components: []
}

const sender = {
    from: '14155552672',
    wabaId: 'waba_1',
    verifiedName: 'Acme Support'
}

describe('chatbase whatsapp templates', () => {
    it('renders a plain row with name, language, category, format, waba, variables', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/whatsapp/templates',
                method: 'GET'
            })
            .reply(200, {
                templates: [template],
                complete: true,
                unavailableWabaIds: [],
                senders: [sender]
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await WhatsappTemplates.run(['--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'order_update\ten_US\tUTILITY\tPOSITIONAL\twaba_1\theader:1 body:1,2'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '14155552672 (Acme Support) — waba waba_1'
        )
    })

    it('--json emits the raw response and warns when the list is partial', async () => {
        const payload = {
            templates: [template],
            complete: false,
            unavailableWabaIds: ['waba_2'],
            senders: [sender]
        }
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/whatsapp/templates',
                method: 'GET'
            })
            .reply(200, payload)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await WhatsappTemplates.run(['--json'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(payload)
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'partial list — could not read WABA(s): waba_2'
        )
    })

    it('surfaces WHATSAPP_NOT_CONNECTED as an API error', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/whatsapp/templates',
                method: 'GET'
            })
            .reply(403, {
                error: {
                    code: 'WHATSAPP_NOT_CONNECTED',
                    message: 'WhatsApp is not connected for this agent'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            WhatsappTemplates.run(['--plain'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'WhatsApp is not connected'
        )
    })

    it('notes "No results." when the agent has no templates', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/whatsapp/templates',
                method: 'GET'
            })
            .reply(200, { templates: [], senders: [], complete: true })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await WhatsappTemplates.run([], process.cwd())
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'No results.'
        )
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe('')
    })
})

describe('chatbase whatsapp send-template', () => {
    const sentResponse = {
        messageId: 'wamid.XYZ',
        conversationId: 'conv_1',
        to: '14155552671'
    }

    it('POSTs {to, from, template} and prints the messageId', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/whatsapp/messages/template',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return sentResponse
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await WhatsappSendTemplate.run(
            [
                'order_update',
                '--to',
                '14155552671',
                '--from',
                '14155552672',
                '--language',
                'en_US',
                '--variables',
                '{"header":{"1":"#1042"},"body":{"1":"Jane","2":"Friday"}}'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            to: '14155552671',
            from: '14155552672',
            template: {
                name: 'order_update',
                language: 'en_US',
                variables: {
                    header: { '1': '#1042' },
                    body: { '1': 'Jane', '2': 'Friday' }
                }
            }
        })
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'wamid.XYZ\n'
        )
        const notes = err.mock.calls.map((c) => String(c[0])).join('')
        expect(notes).toContain('Sent template "order_update" to 14155552671')
        expect(notes).toContain('Conversation: conv_1')
    })

    it('omits optional fields and --json emits the raw response', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/whatsapp/messages/template',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return sentResponse
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await WhatsappSendTemplate.run(
            ['order_update', '--to', '14155552671', '--json'],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            to: '14155552671',
            template: { name: 'order_update', variables: {} }
        })
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(sentResponse)
    })

    it('resolves --variables @- from piped stdin', async () => {
        const { Readable } = await import('node:stream')
        const stdin = Readable.from([
            '{"body":{"1":"Jane"}}'
        ]) as unknown as NodeJS.ReadStream & { fd: 0 }
        Object.defineProperty(stdin, 'isTTY', { value: false })
        vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/whatsapp/messages/template',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return sentResponse
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await WhatsappSendTemplate.run(
            ['order_update', '--to', '14155552671', '--variables', '@-'],
            process.cwd()
        )
        expect(JSON.parse(sentBody).template.variables).toEqual({
            body: { '1': 'Jane' }
        })
    })

    it('rejects invalid --variables JSON as a usage error', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            WhatsappSendTemplate.run(
                [
                    'order_update',
                    '--to',
                    '14155552671',
                    '--variables',
                    'not-json'
                ],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '--variables must be valid JSON'
        )
    })

    it('rejects a non-object --variables value as a usage error', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            WhatsappSendTemplate.run(
                ['order_update', '--to', '14155552671', '--variables', '[1,2]'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'grouped by component'
        )
    })

    it('surfaces TEMPLATE_LANGUAGE_REQUIRED as an API error', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/whatsapp/messages/template',
                method: 'POST'
            })
            .reply(400, {
                error: {
                    code: 'TEMPLATE_LANGUAGE_REQUIRED',
                    message:
                        'Multiple languages exist for this template; specify a language'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            WhatsappSendTemplate.run(
                ['order_update', '--to', '14155552671'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'specify a language'
        )
    })
})
