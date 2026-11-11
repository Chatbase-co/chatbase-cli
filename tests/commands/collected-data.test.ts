import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CollectedDataList from '../../src/commands/collected-data/list.js'

const BASE = 'https://www.chatbase.co'
const LIST_PATH = '/api/v2/agents/agt_1/collected-data'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-collected-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

const full = {
    id: 'sub_1',
    conversationId: 'conv_1',
    actionId: 'a1b2c3d4-0000-4000-8000-000000000000',
    actionName: 'Collect leads',
    customFields: { email: 'a@b.co' },
    createdAt: 1790000000
}
const sparse = {
    ...full,
    id: 'sub_2',
    conversationId: null,
    actionId: null,
    customFields: null
}

function stdout() {
    return vi.spyOn(process.stdout, 'write').mockReturnValue(true)
}
const joined = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => String(c[0])).join('')

describe('chatbase collected-data list', () => {
    it('renders rows with null fields as blanks', async () => {
        mock.get(BASE)
            .intercept({ path: LIST_PATH, method: 'GET' })
            .reply(200, {
                data: [full, sparse],
                pagination: { cursor: null, hasMore: false }
            })
        const out = stdout()
        await CollectedDataList.run(['--plain'], process.cwd())
        const text = joined(out)
        expect(text).toContain(
            'sub_1\tCollect leads\tconv_1\t{"email":"a@b.co"}\t1790000000'
        )
        expect(text).toContain('sub_2\tCollect leads\t\t\t1790000000')
    })

    it('sends filters under their spec names', async () => {
        mock.get(BASE)
            .intercept({
                path: LIST_PATH,
                method: 'GET',
                query: {
                    actionId: full.actionId,
                    startDate: '2026-11-01',
                    endDate: '2026-11-10',
                    limit: '5'
                }
            })
            .reply(200, {
                data: [],
                pagination: { cursor: null, hasMore: false }
            })
        stdout()
        await CollectedDataList.run(
            [
                '--action-id',
                full.actionId,
                '--start-date',
                '2026-11-01',
                '--end-date',
                '2026-11-10',
                '--limit',
                '5',
                '--json'
            ],
            process.cwd()
        )
    })

    it('rejects --limit above 100 before calling the API', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            CollectedDataList.run(['--limit', '101'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('--all pages through an empty page while hasMore is true', async () => {
        mock.get(BASE)
            .intercept({ path: LIST_PATH, method: 'GET' })
            .reply(200, {
                data: [],
                pagination: { cursor: 'c1', hasMore: true }
            })
        mock.get(BASE)
            .intercept({
                path: LIST_PATH,
                method: 'GET',
                query: { cursor: 'c1' }
            })
            .reply(200, {
                data: [full],
                pagination: { cursor: null, hasMore: false }
            })
        const out = stdout()
        await CollectedDataList.run(['--all', '--json'], process.cwd())
        expect(JSON.parse(joined(out))).toEqual({
            data: [full],
            pagination: { cursor: null, hasMore: false }
        })
    })

    it('explains VALIDATION_INVALID_DATE_RANGE', async () => {
        mock.get(BASE)
            .intercept({
                path: LIST_PATH,
                method: 'GET',
                query: { startDate: '2026-11-10', endDate: '2026-11-01' }
            })
            .reply(400, {
                error: {
                    code: 'VALIDATION_INVALID_DATE_RANGE',
                    message: 'startDate must not be after endDate'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            CollectedDataList.run(
                ['--start-date', '2026-11-10', '--end-date', '2026-11-01'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(joined(err)).toContain('Swap them')
    })
})
