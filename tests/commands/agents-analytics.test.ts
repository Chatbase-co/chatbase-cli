import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentsAnalytics from '../../src/commands/agents/analytics.js'
import SourcesList from '../../src/commands/sources/list.js'
import TicketsReply from '../../src/commands/tickets/reply.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-analytics-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

const analytics = {
    buckets: [
        {
            start: 1788000000,
            end: 1788086400,
            conversations: 5,
            messages: 20,
            positive: 2,
            neutral: 2,
            negative: 1,
            escalated: 1,
            thumbsUp: 3,
            thumbsDown: 0,
            ticketsByStatus: null,
            procedures: [],
            tools: [],
            actionTypes: []
        }
    ],
    sources: [],
    toolsUsed: [],
    countries: [],
    confidence: [],
    conversationsByHour: [],
    creditsByDay: []
}

describe('chatbase agents analytics', () => {
    it('sends spec-named query params and renders one row per bucket', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/analytics',
                method: 'GET',
                query: {
                    startDate: '2026-10-01',
                    endDate: '2026-10-07',
                    timeZone: 'America/New_York'
                }
            })
            .reply(200, analytics)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsAnalytics.run(
            [
                '--start-date',
                '2026-10-01',
                '--end-date',
                '2026-10-07',
                '--time-zone',
                'America/New_York',
                '--plain'
            ],
            process.cwd()
        )
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain(
            '2026-08-29T10:40:00.000Z\t2026-08-30T10:40:00.000Z\t5\t20\t2\t2\t1\t1\t3\t0'
        )
    })

    it('--json passes the full response through', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/analytics',
                method: 'GET'
            })
            .reply(200, analytics)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsAnalytics.run(['--json'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(analytics)
    })

    it('surfaces API errors', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/analytics',
                method: 'GET',
                query: { startDate: '2000-01-01' }
            })
            .reply(400, {
                error: {
                    code: 'VALIDATION_SEARCH_WINDOW_EXCEEDED',
                    message:
                        'The requested dates are before the searchable window'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            AgentsAnalytics.run(['--start-date', '2000-01-01'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        const printed = err.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('VALIDATION_SEARCH_WINDOW_EXCEEDED')
        expect(printed).toContain('chatbase conversations export')
    })

    it('adds a retry hint to CONVERSATION_SEARCH_BUSY', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/analytics',
                method: 'GET'
            })
            .reply(503, {
                error: { code: 'CONVERSATION_SEARCH_BUSY', message: 'busy' }
            })
            .times(2) // GETs retry once on 5xx
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            AgentsAnalytics.run([], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        const printed = err.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('CONVERSATION_SEARCH_BUSY')
        expect(printed).toContain('retry in a few seconds')
    })
})

describe('chatbase sources list --status', () => {
    it('sends the status query param', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources',
                method: 'GET',
                query: { status: 'failed' }
            })
            .reply(200, {
                data: [],
                pagination: { cursor: null, hasMore: false, total: 0 }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesList.run(['--status', 'failed'], process.cwd())
    })

    it('rejects an unknown status locally', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesList.run(['--status', 'bogus'], process.cwd())
        ).rejects.toThrow()
    })
})

describe('chatbase tickets reply --type', () => {
    it.each([
        { extra: [], type: 'reply', printed: 'Reply posted to ticket 42' },
        {
            extra: ['--type', 'note'],
            type: 'note',
            printed: 'Note posted to ticket 42'
        }
    ])('sends type $type', async ({ extra, type, printed }) => {
        let sent = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets/42/messages',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sent = Buffer.from(opts.body as Uint8Array).toString('utf8')
                return {}
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsReply.run(
            [
                '42',
                '-m',
                'internal',
                ...extra,
                '--author-email',
                'sam@example.com'
            ],
            process.cwd()
        )
        expect(JSON.parse(sent)).toMatchObject({ type, content: 'internal' })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            printed
        )
    })
})
