import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActionsDelete from '../../src/commands/actions/delete.js'
import ActionsGet from '../../src/commands/actions/get.js'
import ActionsList from '../../src/commands/actions/list.js'
import ActionsUpdate from '../../src/commands/actions/update.js'
import ProceduresCreate from '../../src/commands/procedures/create.js'
import ProceduresDelete from '../../src/commands/procedures/delete.js'
import ProceduresGet from '../../src/commands/procedures/get.js'
import ProceduresList from '../../src/commands/procedures/list.js'
import ProceduresUpdate from '../../src/commands/procedures/update.js'

const BASE = 'https://www.chatbase.co'
const AID = '0b8f3c1e-0000-4000-8000-000000000001'
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
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-actions-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

const stdout = () => vi.spyOn(process.stdout, 'write').mockReturnValue(true)
const joined = (spy: ReturnType<typeof stdout>) =>
    spy.mock.calls.map((c) => String(c[0])).join('')

const action = {
    id: AID,
    name: 'get_order',
    type: 'custom-action',
    status: 'enabled',
    procedureOnly: false
}

describe('chatbase actions', () => {
    it('list renders rows and sends limit', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/actions',
                method: 'GET',
                query: { limit: 5 }
            })
            .reply(200, {
                data: [action],
                pagination: { cursor: null, hasMore: false, total: 1 }
            })
        const out = stdout()
        await ActionsList.run(['--plain', '--limit', '5'], process.cwd())
        expect(joined(out)).toContain(
            `${AID}\tget_order\tcustom-action\tenabled\tfalse`
        )
    })

    it('list --all pages through an empty page while hasMore is true', async () => {
        const pool = mock.get(BASE)
        pool.intercept({
            path: '/api/v2/agents/agt_1/actions',
            method: 'GET'
        }).reply(200, {
            data: [],
            pagination: { cursor: 'c1', hasMore: true, total: 1 }
        })
        pool.intercept({
            path: '/api/v2/agents/agt_1/actions',
            method: 'GET',
            query: { cursor: 'c1' }
        }).reply(200, {
            data: [action],
            pagination: { cursor: null, hasMore: false, total: 1 }
        })
        const out = stdout()
        await ActionsList.run(['--all', '--json'], process.cwd())
        expect(JSON.parse(joined(out)).data).toHaveLength(1)
    })

    it('list rejects --limit above 100 locally', async () => {
        await expect(
            ActionsList.run(['--limit', '101'], process.cwd())
        ).rejects.toThrow()
    })

    it('get renders a null whenToUse as empty', async () => {
        mock.get(BASE)
            .intercept({
                path: `/api/v2/agents/agt_1/actions/${AID}`,
                method: 'GET'
            })
            .reply(200, {
                ...action,
                whenToUse: null,
                fields: [],
                channels: [
                    {
                        channel: 'slack',
                        connected: true,
                        setup: true,
                        enabled: true
                    }
                ]
            })
        const out = stdout()
        await ActionsGet.run([AID, '--plain'], process.cwd())
        const text = joined(out)
        expect(text).toContain('get_order')
        expect(text).not.toContain('null')
    })

    it('update sends only the given fields, including channels', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({
                path: `/api/v2/agents/agt_1/actions/${AID}`,
                method: 'PATCH'
            })
            .reply(200, (opts) => {
                sent = bodyText(opts.body)
                return {
                    ...action,
                    whenToUse: null,
                    fields: [],
                    channels: [],
                    warnings: ['p mentions it']
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ActionsUpdate.run(
            [
                AID,
                '--status',
                'disabled',
                '--channel',
                'whatsapp=off',
                '--no-procedure-only'
            ],
            process.cwd()
        )
        expect(JSON.parse(sent)).toEqual({
            status: 'disabled',
            procedureOnly: false,
            channels: [{ channel: 'whatsapp', enabled: false }]
        })
        expect(err.mock.calls.join('')).toContain('warning: p mentions it')
    })

    it('update with nothing to change exits as a usage error', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ActionsUpdate.run([AID], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.join('')).toContain('Nothing to update')
    })

    it('update surfaces ACTION_NAME_TAKEN with remediation', async () => {
        mock.get(BASE)
            .intercept({
                path: `/api/v2/agents/agt_1/actions/${AID}`,
                method: 'PATCH'
            })
            .reply(409, {
                error: { code: 'ACTION_NAME_TAKEN', message: 'Name taken' }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ActionsUpdate.run([AID, '--name', 'x_y'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(err.mock.calls.join('')).toContain('ACTION_NAME_TAKEN')
        expect(err.mock.calls.join('')).toContain('Pick a different --name')
    })

    it('delete calls DELETE', async () => {
        mock.get(BASE)
            .intercept({
                path: `/api/v2/agents/agt_1/actions/${AID}`,
                method: 'DELETE'
            })
            .reply(200, { success: true })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ActionsDelete.run([AID], process.cwd())
        expect(err.mock.calls.join('')).toContain(`Deleted action ${AID}`)
    })
})

const proc = {
    id: AID,
    name: 'Refund',
    status: 'disabled',
    trigger: 'Refund request',
    unavailableActions: ['@get_order']
}

describe('chatbase procedures', () => {
    it('list renders rows', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/procedures',
                method: 'GET'
            })
            .reply(200, {
                data: [proc],
                pagination: { cursor: null, hasMore: false, total: 1 }
            })
        const out = stdout()
        await ProceduresList.run(['--plain'], process.cwd())
        expect(joined(out)).toContain(
            `${AID}\tRefund\tdisabled\tRefund request\t@get_order`
        )
    })

    it('get prints steps with branches', async () => {
        mock.get(BASE)
            .intercept({
                path: `/api/v2/agents/agt_1/procedures/${AID}`,
                method: 'GET'
            })
            .reply(200, {
                ...proc,
                steps: [
                    { kind: 'instruction', text: 'Ask for the order' },
                    {
                        kind: 'branch',
                        branches: [
                            {
                                condition: 'older than 30 days',
                                steps: [
                                    { kind: 'instruction', text: 'Decline' }
                                ]
                            }
                        ],
                        otherwise: {
                            steps: [{ kind: 'instruction', text: 'Refund' }]
                        }
                    }
                ]
            })
        const out = stdout()
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true
        })
        try {
            await ProceduresGet.run([AID], process.cwd())
        } finally {
            Object.defineProperty(process.stdout, 'isTTY', {
                value: undefined,
                configurable: true
            })
        }
        const text = joined(out)
        expect(text).toContain('1. Ask for the order')
        expect(text).toContain('If older than 30 days:')
        expect(text).toContain('Otherwise:')
    })

    it('create sends name, trigger and steps', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/procedures',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sent = bodyText(opts.body)
                return { ...proc, steps: [] }
            })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ProceduresCreate.run(
            [
                '--name',
                'Refund',
                '--trigger',
                'Refund request',
                '--step',
                'Call @get_order'
            ],
            process.cwd()
        )
        expect(JSON.parse(sent)).toEqual({
            name: 'Refund',
            trigger: 'Refund request',
            steps: [{ kind: 'instruction', text: 'Call @get_order' }]
        })
    })

    it('create requires steps', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ProceduresCreate.run(
                ['--name', 'n', '--trigger', 't'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.join('')).toContain('--steps')
    })

    it('update sends status and surfaces PROCEDURE_CHANGE_NOT_ALLOWED', async () => {
        let sent = ''
        const pool = mock.get(BASE)
        pool.intercept({
            path: `/api/v2/agents/agt_1/procedures/${AID}`,
            method: 'PATCH'
        }).reply(200, (opts) => {
            sent = bodyText(opts.body)
            return { ...proc, steps: [] }
        })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ProceduresUpdate.run([AID, '--status', 'enabled'], process.cwd())
        expect(JSON.parse(sent)).toEqual({ status: 'enabled' })

        pool.intercept({
            path: `/api/v2/agents/agt_1/procedures/${AID}`,
            method: 'PATCH'
        }).reply(409, {
            error: {
                code: 'PROCEDURE_CHANGE_NOT_ALLOWED',
                message: '@get_order is disabled'
            }
        })
        await expect(
            ProceduresUpdate.run([AID, '--status', 'enabled'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(
            (
                process.stderr.write as unknown as {
                    mock: { calls: unknown[] }
                }
            ).mock.calls.join('')
        ).toContain('PROCEDURE_CHANGE_NOT_ALLOWED')
    })

    it('delete calls DELETE', async () => {
        mock.get(BASE)
            .intercept({
                path: `/api/v2/agents/agt_1/procedures/${AID}`,
                method: 'DELETE'
            })
            .reply(200, { success: true })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ProceduresDelete.run([AID], process.cwd())
        expect(err.mock.calls.join('')).toContain(`Deleted procedure ${AID}`)
    })
})
