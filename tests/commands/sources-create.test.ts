import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SourcesCreate from '../../src/commands/sources/create.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

// The mock reply callback's `opts.body` may arrive as a string, Buffer, or
// Uint8Array depending on how the request body was read off the wire.
function bodyText(body: unknown): string {
    if (body == null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
    return String(body)
}

function tmpFile(name: string, contents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sources-create-'))
    const file = path.join(dir, name)
    fs.writeFileSync(file, contents)
    return file
}

const createdTextSource = {
    id: 'src_new',
    type: 'text',
    name: 'Guide',
    size: 11,
    createdAt: '2026-01-01T00:00:00Z',
    status: 'untrained',
    metadata: null
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sources-create-cfg-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase sources create --type text', () => {
    it('POSTs the exact JSON body and prints the id, with a success note and next-step hint', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return createdTextSource
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesCreate.run(
            ['--type', 'text', '--name', 'Guide', '--content', 'hello world'],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            type: 'text',
            name: 'Guide',
            content: 'hello world'
        })
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'src_new\n'
        )
        const stderr = err.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('✓ Created source src_new (untrained)')
        expect(stderr).toContain('sources get src_new -a agt_1')
    })

    it('--content @file reads the text content from disk', async () => {
        const f = tmpFile('body.txt', 'from disk')
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return createdTextSource
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesCreate.run(
            ['--type', 'text', '--name', 'Guide', '--content', `@${f}`],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toMatchObject({ content: 'from disk' })
    })
})

describe('chatbase sources create --type link', () => {
    it('POSTs the exact JSON body with crawl-control fields defaulted', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return {
                    id: 'src_link',
                    type: 'link',
                    name: 'https://example.com',
                    size: 0,
                    createdAt: '2026-01-01T00:00:00Z',
                    status: 'untrained',
                    metadata: { type: 'crawl' }
                }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesCreate.run(
            [
                '--type',
                'link',
                '--url',
                'https://example.com',
                '--link-type',
                'crawl'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            type: 'link',
            url: 'https://example.com',
            linkType: 'crawl',
            excludePaths: [],
            includeOnlyPaths: [],
            slowScraping: false
        })
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'src_link\n'
        )
    })

    it('lets --data override the crawl-control defaults', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return {
                    id: 'src_link2',
                    type: 'link',
                    name: 'https://example.com',
                    size: 0,
                    createdAt: '2026-01-01T00:00:00Z',
                    status: 'untrained',
                    metadata: { type: 'crawl' }
                }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesCreate.run(
            [
                '--type',
                'link',
                '--url',
                'https://example.com',
                '--link-type',
                'crawl',
                '--data',
                '{"slowScraping":true,"excludePaths":["/admin"]}'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            type: 'link',
            url: 'https://example.com',
            linkType: 'crawl',
            excludePaths: ['/admin'],
            includeOnlyPaths: [],
            slowScraping: true
        })
    })
})

describe('chatbase sources create --type qna', () => {
    it('takes questions/answer from --data and --name as a dedicated override', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return {
                    id: 'src_qna',
                    type: 'qna',
                    name: 'FAQ',
                    size: 0,
                    createdAt: '2026-01-01T00:00:00Z',
                    status: 'untrained',
                    metadata: null
                }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesCreate.run(
            [
                '--type',
                'qna',
                '--data',
                '{"questions":["Q1"],"answer":"A1","name":"From Data"}',
                '--name',
                'FAQ'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            type: 'qna',
            questions: ['Q1'],
            answer: 'A1',
            name: 'FAQ'
        })
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'src_qna\n'
        )
    })
})

describe('chatbase sources create --file', () => {
    it('uploads via the files host and prints the new id', async () => {
        const f = tmpFile('guide.pdf', 'PDFDATA')
        let sentName = ''
        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                const form = opts.body as unknown as FormData
                sentName = String(form.get('name'))
                return { id: 'src_file', type: 'file', status: 'untrained' }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesCreate.run(['--file', f], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'src_file\n'
        )
        expect(sentName).toBe('guide.pdf')
        const stderr = err.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('✓ Created source src_file (untrained)')
    })

    it('honors --name to override the default (file basename) name field', async () => {
        const f = tmpFile('guide.pdf', 'PDFDATA')
        let sentName = ''
        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                const form = opts.body as unknown as FormData
                sentName = String(form.get('name'))
                return { id: 'src_file2', type: 'file', status: 'untrained' }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesCreate.run(
            ['--file', f, '--name', 'Custom'],
            process.cwd()
        )
        expect(sentName).toBe('Custom')
    })

    it('rejects --type and --file together before any network call', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesCreate.run(
                ['--type', 'text', '--file', '/tmp/whatever'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('rejects a missing file before any network call', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesCreate.run(
                ['--file', '/definitely/does/not/exist-cb-test'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('rejects when neither --type nor --file is given', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesCreate.run([], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})
