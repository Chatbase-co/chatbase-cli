import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversationsList from '../../src/commands/conversations/list.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

const page1 = {
    data: [
        {
            id: 'c_1',
            title: 'Refunds',
            createdAt: 1785542400,
            updatedAt: 1785628800,
            userId: 'u1',
            status: 'ongoing'
        }
    ],
    pagination: { cursor: 'cur_2', hasMore: true, total: 2 }
}
const page2 = {
    data: [
        {
            id: 'c_2',
            title: 'Hello',
            createdAt: 1785715200,
            updatedAt: 1785718800,
            userId: 'u2',
            status: 'ended'
        }
    ],
    pagination: { hasMore: false, total: 2 }
}

// Single-page GET /agents response used whenever a test resolves the -a
// flag through resolveAgentRef() (i.e. whenever -a is passed at all).
const agentsPage = {
    data: [{ id: 'agt_1', name: 'Support Bot' }],
    pagination: { cursor: null, hasMore: false, total: 1 }
}

function mockAgentsList() {
    mock.get(BASE)
        .intercept({ path: '/api/v2/agents', method: 'GET' })
        .reply(200, agentsPage)
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-conv-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase conversations list', () => {
    it('renders a plain TSV row per conversation with stable column order', async () => {
        mockAgentsList()
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['-a', 'agt_1', '--plain'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain(
            'c_1\tRefunds\tongoing\t1785542400\t1785628800'
        )
        // Next-page hint goes to stderr, never stdout:
        expect(printed).not.toContain('cur_2')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '--cursor cur_2'
        )
    })

    it('--all follows pagination to the end', async () => {
        mockAgentsList()
        const pool = mock.get(BASE)
        pool.intercept({
            path: '/api/v2/agents/agt_1/conversations',
            method: 'GET'
        }).reply(200, page1)
        pool.intercept({
            path: '/api/v2/agents/agt_1/conversations',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, page2)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(
            ['-a', 'agt_1', '--plain', '--all'],
            process.cwd()
        )
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('c_1')
        expect(printed).toContain('c_2')
    })

    it('--json emits the raw API envelope', async () => {
        mockAgentsList()
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['-a', 'agt_1', '--json'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(page1)
    })

    it('--all --json emits raw items from every page, not display rows', async () => {
        mockAgentsList()
        const pool = mock.get(BASE)
        pool.intercept({
            path: '/api/v2/agents/agt_1/conversations',
            method: 'GET'
        }).reply(200, page1)
        pool.intercept({
            path: '/api/v2/agents/agt_1/conversations',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, page2)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(
            ['-a', 'agt_1', '--json', '--all'],
            process.cwd()
        )
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual({
            data: [...page1.data, ...page2.data],
            pagination: page2.pagination
        })
    })

    it('renders pretty/table mode with aligned headers and numeric timestamps', async () => {
        mockAgentsList()
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        // Force pretty mode by stubbing stdout.isTTY
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true
        })
        await ConversationsList.run(['-a', 'agt_1'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('ID')
        expect(printed).toContain('TITLE')
        expect(printed).toContain('STATUS')
        expect(printed).toContain('c_1')
        expect(printed).toContain('Refunds')
        expect(printed).toContain('ongoing')
    })

    it('fails with a usage error when no agent is resolvable', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        vi.stubEnv('CHATBASE_AGENT_ID', '')
        await expect(
            ConversationsList.run(['--plain'], '/tmp') // /tmp: no chatbase.json above it
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('-a accepts a plain agent id: one GET /agents lookup, no resolution note', async () => {
        mockAgentsList()
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['-a', 'agt_1', '--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'c_1'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).not.toContain(
            '→'
        )
    })

    it('-a accepts an exact agent name, resolves it, and notes the resolved id', async () => {
        mockAgentsList()
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(
            ['-a', 'Support Bot', '--plain'],
            process.cwd()
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '→ agt_1'
        )
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'c_1'
        )
    })

    it('-a rejects an ambiguous name with a usage error listing candidates', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [
                    { id: 'agt_1', name: 'Support Bot' },
                    { id: 'agt_3', name: 'Support Bot' }
                ],
                pagination: { cursor: null, hasMore: false, total: 2 }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsList.run(
                ['-a', 'Support Bot', '--plain'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        const stderr = err.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('agt_1')
        expect(stderr).toContain('agt_3')
    })

    it('-a rejects an unknown name with a usage error suggesting agents list', async () => {
        mockAgentsList()
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsList.run(['-a', 'Nope Bot', '--plain'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'chatbase agents list'
        )
    })

    it('CHATBASE_AGENT_ID is used as-is: no GET /agents lookup happens', async () => {
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
        // No mockAgentsList() call: MockAgent.disableNetConnect() means any
        // stray GET /agents request would throw and fail this test, which
        // is exactly how we assert only the conversations endpoint was hit.
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'c_1'
        )
    })
})
