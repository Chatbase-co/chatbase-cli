import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversationsSearch from '../../src/commands/conversations/search.js'

const BASE = 'https://www.chatbase.co'
const SEARCH_PATH = '/api/v2/agents/agt_1/conversations/search'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-conv-search-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

const hit = {
    id: 'conv_1',
    title: 'Refund question',
    createdAt: 1790000000,
    updatedAt: 1790003600,
    userId: null,
    source: 'WhatsApp',
    embedOrigin: null,
    status: 'ended',
    snippet: {
        speaker: 'user',
        highlights: [
            { value: 'I want a ', isHit: false },
            { value: 'refund', isHit: true },
            { value: '\nplease', isHit: false }
        ]
    }
}

const filterOnly = {
    ...hit,
    id: 'conv_2',
    title: null,
    source: null,
    snippet: null
}

function stdout() {
    return vi.spyOn(process.stdout, 'write').mockReturnValue(true)
}
function joined(spy: ReturnType<typeof stdout>): string {
    return spy.mock.calls.map((c) => String(c[0])).join('')
}

describe('chatbase conversations search', () => {
    it('renders snippet text and blanks for null title/source/snippet', async () => {
        mock.get(BASE)
            .intercept({
                path: SEARCH_PATH,
                method: 'GET',
                query: { query: 'refund' }
            })
            .reply(200, {
                data: [hit, filterOnly],
                pagination: { cursor: null, hasMore: false }
            })
        const out = stdout()
        await ConversationsSearch.run(['refund', '--plain'], process.cwd())
        const text = joined(out)
        expect(text).toContain(
            'conv_1\tRefund question\tWhatsApp\tended\t1790003600\tI want a refund please'
        )
        expect(text).toContain('conv_2\t\t\tended\t1790003600\t')
    })

    it('maps flags to spec query params, including the string-enum booleans', async () => {
        mock.get(BASE)
            .intercept({
                path: SEARCH_PATH,
                method: 'GET',
                query: {
                    query: 'cancel',
                    source: 'API,WhatsApp',
                    userId: 'usr_1',
                    activityState: 'ended',
                    toolOutcome: 'error',
                    escalated: 'true',
                    hasVoice: 'false',
                    startDate: '2026-09-01',
                    updatedBefore: '2026-10-01',
                    limit: '10'
                }
            })
            .reply(200, {
                data: [],
                pagination: { cursor: null, hasMore: false }
            })
        stdout()
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsSearch.run(
            [
                'cancel',
                '--source',
                'API,WhatsApp',
                '--user-id',
                'usr_1',
                '--activity-state',
                'ended',
                '--tool-outcome',
                'error',
                '--escalated',
                '--no-has-voice',
                '--start-date',
                '2026-09-01',
                '--updated-before',
                '2026-10-01',
                '--limit',
                '10',
                '--json'
            ],
            process.cwd()
        )
    })

    it('rejects --limit above the endpoint cap of 25 before calling the API', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsSearch.run(['--limit', '26'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('--all keeps paging through an empty page while hasMore is true', async () => {
        mock.get(BASE)
            .intercept({ path: SEARCH_PATH, method: 'GET' })
            .reply(200, {
                data: [],
                pagination: { cursor: 'c1', hasMore: true }
            })
        mock.get(BASE)
            .intercept({
                path: SEARCH_PATH,
                method: 'GET',
                query: { cursor: 'c1' }
            })
            .reply(200, {
                data: [hit],
                pagination: { cursor: null, hasMore: false }
            })
        const out = stdout()
        await ConversationsSearch.run(['--all', '--json'], process.cwd())
        expect(JSON.parse(joined(out))).toEqual({
            data: [hit],
            pagination: { cursor: null, hasMore: false }
        })
    })

    it('points at --cursor when a single page is empty but hasMore is true', async () => {
        mock.get(BASE)
            .intercept({ path: SEARCH_PATH, method: 'GET' })
            .reply(200, {
                data: [],
                pagination: { cursor: 'c1', hasMore: true }
            })
        stdout()
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConversationsSearch.run([], process.cwd())
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'rerun with --cursor c1 and the same query and filters'
        )
    })

    it('surfaces CONVERSATION_SEARCH_UNAVAILABLE with a filters-only hint', async () => {
        mock.get(BASE)
            .intercept({
                path: SEARCH_PATH,
                method: 'GET',
                query: { query: 'refund' }
            })
            .reply(403, {
                error: {
                    code: 'CONVERSATION_SEARCH_UNAVAILABLE',
                    message:
                        'Conversation search is not available for this agent'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConversationsSearch.run(['refund'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'Drop the QUERY argument'
        )
    })
})
