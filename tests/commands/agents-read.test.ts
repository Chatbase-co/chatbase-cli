import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentsGet from '../../src/commands/agents/get.js'
import AgentsList from '../../src/commands/agents/list.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

const agent = {
    id: 'agt_1',
    name: 'Support Bot',
    model: 'gpt-5',
    visibility: 'private',
    autoRetrain: false,
    status: 'trained'
}

const agent2 = {
    id: 'agt_2',
    name: 'Sales Bot',
    model: 'gpt-4o',
    visibility: 'public',
    autoRetrain: true
}

const listPage1 = {
    data: [agent],
    pagination: { cursor: 'cur_2', hasMore: true, total: 2 }
}

const listPage2 = {
    data: [agent2],
    pagination: { cursor: null, hasMore: false, total: 2 }
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-agents-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase agents list', () => {
    it('agents list renders plain rows', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, listPage1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await AgentsList.run(['--plain'], process.cwd())
        expect(out.mock.calls.join('')).toContain(
            'agt_1\tSupport Bot\tgpt-5\tprivate'
        )
    })

    it('agents list --json emits the raw API envelope', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, listPage1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await AgentsList.run(['--json'], process.cwd())
        expect(JSON.parse(out.mock.calls.join(''))).toEqual(listPage1)
    })

    it('--all follows pagination to the end', async () => {
        const pool = mock.get(BASE)
        pool.intercept({ path: '/api/v2/agents', method: 'GET' }).reply(
            200,
            listPage1
        )
        pool.intercept({
            path: '/api/v2/agents',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, listPage2)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsList.run(['--plain', '--all'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('agt_1')
        expect(printed).toContain('agt_2')
    })

    it('--all --json emits raw items from every page, not display rows', async () => {
        const pool = mock.get(BASE)
        pool.intercept({ path: '/api/v2/agents', method: 'GET' }).reply(
            200,
            listPage1
        )
        pool.intercept({
            path: '/api/v2/agents',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, listPage2)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsList.run(['--json', '--all'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual({
            data: [agent, agent2],
            pagination: listPage2.pagination
        })
    })
})

describe('chatbase agents get', () => {
    it('agents get prints one agent as JSON with --json', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1', method: 'GET' })
            .reply(200, agent)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await AgentsGet.run(['agt_1', '--json'], process.cwd())
        expect(JSON.parse(out.mock.calls.join(''))).toEqual(agent)
    })

    it('agents get renders plain row', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1', method: 'GET' })
            .reply(200, agent)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await AgentsGet.run(['agt_1', '--plain'], process.cwd())
        expect(out.mock.calls.join('')).toContain(
            'agt_1\tSupport Bot\tgpt-5\tprivate'
        )
    })

    it('agents get renders a key-value detail view in pretty mode, not a list row', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1', method: 'GET' })
            .reply(200, agent)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const original = Object.getOwnPropertyDescriptor(
            process.stdout,
            'isTTY'
        )
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true
        })
        try {
            await AgentsGet.run(['agt_1'], process.cwd())
        } finally {
            if (original)
                Object.defineProperty(process.stdout, 'isTTY', original)
        }
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('Name')
        expect(printed).toContain('Support Bot')
        expect(printed).toContain('Model')
        // The API's rich fields finally surface in the human view:
        expect(printed).toContain('Status')
        expect(printed).not.toContain('agt_1\tSupport Bot')
    })
})
