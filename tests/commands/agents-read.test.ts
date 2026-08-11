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
    autoRetrain: false
}

const listPage1 = {
    data: [agent],
    pagination: { cursor: null, hasMore: false, total: 1 }
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
})
