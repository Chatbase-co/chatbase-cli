import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SourcesGet from '../../src/commands/sources/get.js'
import SourcesList from '../../src/commands/sources/list.js'
import SourcesSummary from '../../src/commands/sources/summary.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

// Real SourceListItem shape (id, type, name, size, createdAt, status,
// metadata) — status/type values come straight from the schema's enums.
const src1 = {
    id: 'src_1',
    type: 'file',
    name: 'guide.pdf',
    size: 1024,
    createdAt: '2026-01-01T00:00:00Z',
    status: 'trained',
    metadata: { originalSize: 4096 }
}
const src2 = {
    id: 'src_2',
    type: 'link',
    name: 'https://example.com/docs',
    size: 2048,
    createdAt: '2026-01-02T00:00:00Z',
    status: 'untrained',
    metadata: { type: 'individual' }
}
const src3 = {
    id: 'src_3',
    type: 'qna',
    name: 'FAQ',
    size: 512,
    createdAt: '2026-01-03T00:00:00Z',
    status: 'toBeDeleted',
    metadata: null
}

const page1 = {
    data: [src1],
    pagination: { cursor: 'cur_2', hasMore: true, total: 2 }
}
const page2 = {
    data: [src2],
    pagination: { cursor: null, hasMore: false, total: 2 }
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sources-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase sources list', () => {
    it('renders a plain TSV row per source with stable column order (id, name, type, status, size)', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesList.run(['--plain'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('src_1\tguide.pdf\tfile\ttrained\t1024')
        // Plain mode never gets status glyphs, and the next-page hint goes
        // to stderr only.
        expect(printed).not.toContain('✓')
        expect(printed).not.toContain('cur_2')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '--cursor cur_2'
        )
    })

    it('renders pretty/table mode with status glyphs: trained, untrained, and toBeDeleted', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, {
                data: [src1, src2, src3],
                pagination: { cursor: null, hasMore: false, total: 3 }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true
        })
        await SourcesList.run([], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('✓ trained')
        expect(printed).toContain('… untrained')
        // toBeDeleted has no real-world glyph bucket: raw text, no prefix.
        expect(printed).toContain('toBeDeleted')
        expect(printed).not.toContain('✓ toBeDeleted')
        expect(printed).not.toContain('✗ toBeDeleted')
        expect(printed).not.toContain('… toBeDeleted')
    })

    it('--json emits the raw API envelope for a single page', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesList.run(['--json'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(page1)
    })

    it('--all --json merges every page, preserving non-column fields like createdAt and metadata', async () => {
        const pool = mock.get(BASE)
        pool.intercept({
            path: '/api/v2/agents/agt_1/sources',
            method: 'GET'
        }).reply(200, page1)
        pool.intercept({
            path: '/api/v2/agents/agt_1/sources',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, page2)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesList.run(['--json', '--all'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual({
            data: [src1, src2],
            pagination: page2.pagination
        })
    })
})

describe('chatbase sources get', () => {
    it('renders a plain row for one source', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_1',
                method: 'GET'
            })
            .reply(200, src1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await SourcesGet.run(['src_1', '--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'src_1\tguide.pdf\tfile\ttrained\t1024'
        )
    })

    it('--json emits the raw source object', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_1',
                method: 'GET'
            })
            .reply(200, src1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await SourcesGet.run(['src_1', '--json'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(src1)
    })
})

describe('chatbase sources summary', () => {
    const summary = {
        links: { count: 2, size: 4096 },
        files: { count: 5, size: 102400 },
        qnas: { count: 1, size: 256 },
        notionPages: { count: 0, size: 0 },
        texts: { count: 3, size: 900 },
        zendeskTickets: { count: 0, size: 0 },
        salesforceCases: { count: 0, size: 0 },
        shouldRetrain: true
    }

    it('renders a flattened type/count/size table instead of raw JSON cells', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/summary',
                method: 'GET'
            })
            .reply(200, summary)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true
        })
        await SourcesSummary.run([], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('TYPE')
        expect(printed).toContain('COUNT')
        expect(printed).toContain('SIZE')
        expect(printed).toContain('links')
        expect(printed).not.toContain('"count":2')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toMatch(
            /retrain/i
        )
    })

    it('--json emits the raw summary object', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/summary',
                method: 'GET'
            })
            .reply(200, summary)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await SourcesSummary.run(['--json'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(summary)
    })
})
