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
            createdAt: 1785542400, // 2026-08-01T00:00:00.000Z
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

// GET /agents response used by --agent-name resolution tests only.
const agentsPage = {
    data: [{ id: 'agt_1', name: 'Support Bot' }],
    pagination: { cursor: null, hasMore: false, total: 1 }
}

function mockAgentsList() {
    mock.get(BASE)
        .intercept({ path: '/api/v2/agents', method: 'GET' })
        .reply(200, agentsPage)
}

/** Forces stdout to report as a TTY so printData picks pretty mode. */
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

    it('renders pretty/table mode with aligned headers', async () => {
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

    it('maps the date window flags to startDate/endDate query params', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET',
                query: { startDate: '2024-01-01', endDate: '2024-01-31' }
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(
            [
                '-a',
                'agt_1',
                '--plain',
                '--start-date',
                '2024-01-01',
                '--end-date',
                '2024-01-31'
            ],
            process.cwd()
        )
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'c_1'
        )
    })

    // The per-user endpoint takes only cursor/limit, so the API would drop a
    // date window and return the unfiltered list — a wrong answer that looks
    // like a right one. Refusing locally is the whole point of this guard.
    it('refuses a date window combined with --user instead of silently ignoring it', async () => {
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsList.run(
                [
                    '-a',
                    'agt_1',
                    '--plain',
                    '--user',
                    'usr_1',
                    '--start-date',
                    '2024-01-01'
                ],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'not supported with --user'
        )
    })

    it('surfaces the API error when the date window is inverted', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET',
                query: { startDate: '2024-02-01', endDate: '2024-01-01' }
            })
            .reply(400, {
                error: {
                    code: 'VALIDATION_INVALID_DATE_RANGE',
                    message: 'startDate must not be after endDate'
                }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsList.run(
                [
                    '-a',
                    'agt_1',
                    '--plain',
                    '--start-date',
                    '2024-02-01',
                    '--end-date',
                    '2024-01-01'
                ],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'VALIDATION_INVALID_DATE_RANGE'
        )
    })

    it('fails with a usage error when no agent is resolvable', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        vi.stubEnv('CHATBASE_AGENT_ID', '')
        await expect(
            ConversationsList.run(['--plain'], '/tmp')
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('-a with an ID makes no GET /agents call (no name resolution)', async () => {
        // No mockAgentsList() — disableNetConnect means any stray GET /agents
        // request would throw, proving -a stays ID-only.
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['-a', 'agt_1', '--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'c_1'
        )
    })

    it('--agent-name resolves a name and notes the resolved id', async () => {
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
            ['--agent-name', 'Support Bot', '--plain'],
            process.cwd()
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '→ agt_1'
        )
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'c_1'
        )
    })

    it('--agent-name rejects an ambiguous name with candidates', async () => {
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
                ['--agent-name', 'Support Bot', '--plain'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        const stderr = err.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('agt_1')
        expect(stderr).toContain('agt_3')
    })

    it('--agent-name rejects an unknown name suggesting agents list', async () => {
        mockAgentsList()
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsList.run(
                ['--agent-name', 'Nope Bot', '--plain'],
                process.cwd()
            )
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

describe('chatbase conversations list — human-mode niceties', () => {
    it('formats epoch timestamps as ISO in pretty mode (plain keeps epoch)', async () => {
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, {
                data: page1.data,
                pagination: { cursor: null, hasMore: false, total: 1 }
            })
        const tty = stubStdoutTTY()
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        try {
            await ConversationsList.run([], process.cwd())
        } finally {
            tty.restore()
        }
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('2026-08-01T00:00:00')
        expect(printed).not.toContain('1785542400')
    })

    // The v2 API serves this endpoint from API-created conversations only, so
    // an agent with hundreds of widget chats legitimately lists 0 rows. Saying
    // so is the difference between "the CLI is broken" and "wrong endpoint".
    it('always notes the API-source-only scope and points at export', async () => {
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, {
                data: page1.data,
                pagination: { cursor: null, hasMore: false, total: 1 }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['--plain'], process.cwd())
        const stderr = err.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('API-created conversations')
        expect(stderr).toContain('conversations export')
        // Never on stdout — --plain output must stay parseable.
        expect(out.mock.calls.map((c) => String(c[0])).join('')).not.toContain(
            'API-created'
        )
    })

    it('--quiet suppresses the scope note', async () => {
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, {
                data: page1.data,
                pagination: { cursor: null, hasMore: false, total: 1 }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run(['--plain', '--quiet'], process.cwd())
        expect(err.mock.calls.map((c) => String(c[0])).join('')).not.toContain(
            'API-created'
        )
    })

    it('notes "No results." on stderr for an empty list instead of pure silence', async () => {
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations',
                method: 'GET'
            })
            .reply(200, {
                data: [],
                pagination: { cursor: null, hasMore: false, total: 0 }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsList.run([], process.cwd())
        expect(out.mock.calls.length).toBe(0)
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'No results'
        )
    })
})
