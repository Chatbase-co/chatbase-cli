import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventsSend from '../../src/commands/events/send.js'

const BASE = 'https://www.chatbase.co'
const PATH = '/api/v2/agents/agt_1/missions/events'
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
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-events-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('events send', () => {
    it('sends a person event with properties', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(202, (opts) => {
                sent = bodyText(opts.body)
                return { id: 'ev_1' }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await EventsSend.run(
            [
                'trial_started',
                '--email',
                'ada@example.com',
                '--properties',
                '{"plan":"pro"}',
                '--idempotency-key',
                'k1'
            ],
            process.cwd()
        )
        expect(JSON.parse(sent)).toEqual({
            type: 'trial_started',
            properties: { plan: 'pro' },
            subject: { email: 'ada@example.com' },
            idempotency_key: 'k1'
        })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'ev_1'
        )
    })

    it('sends a run event with effect and defaults properties to {}', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(202, (opts) => {
                sent = bodyText(opts.body)
                return { id: 'ev_2' }
            })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await EventsSend.run(
            [
                'nudge',
                '--run-id',
                '6f1c2d3e-0000-4000-8000-000000000000',
                '--effect',
                'wake',
                '--details',
                'hi',
                '--json'
            ],
            process.cwd()
        )
        expect(JSON.parse(sent)).toEqual({
            type: 'nudge',
            properties: {},
            subject: { run_id: '6f1c2d3e-0000-4000-8000-000000000000' },
            effect: 'wake',
            details: 'hi'
        })
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'ev_2'
        )
    })

    it('requires --effect with --run-id', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            EventsSend.run(['x', '--run-id', 'r'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('rejects --effect without --run-id', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            EventsSend.run(
                ['x', '--email', 'a@b.co', '--effect', 'wake'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('requires exactly one subject flag', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            EventsSend.run(['x'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('rejects non-object --properties', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            EventsSend.run(
                ['x', '--email', 'a@b.co', '--properties', '[1]'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('surfaces EVENT_RUN_ENDED with remediation', async () => {
        mock.get(BASE)
            .intercept({ path: PATH, method: 'POST' })
            .reply(409, {
                error: {
                    code: 'EVENT_RUN_ENDED',
                    message: 'This run has already ended'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            EventsSend.run(
                ['x', '--run-id', 'r', '--effect', 'end_run'],
                process.cwd()
            )
        ).rejects.toBeDefined()
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'already ended'
        )
    })
})
