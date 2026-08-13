import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadFileSource } from '../../src/client/files.js'
import { ApiError } from '../../src/errors/errors.js'

let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
})

afterEach(async () => {
    await mock.close()
    vi.unstubAllEnvs()
})

function tmpFile(name: string, contents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-up-'))
    const file = path.join(dir, name)
    fs.writeFileSync(file, contents)
    return file
}

describe('uploadFileSource', () => {
    it('POSTs a multipart body with name+file fields and returns the new source id', async () => {
        const f = tmpFile('guide.pdf', 'PDFDATA')
        let contentType = ''
        let sentName = ''
        let sentFileName = ''
        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                contentType = String(
                    (opts.headers as Record<string, string>)['content-type']
                )
                const form = opts.body as unknown as FormData
                sentName = String(form.get('name'))
                const file = form.get('file') as File
                sentFileName = file.name
                return { data: { id: 'src_new' } }
            })
        const res = await uploadFileSource({
            agentId: 'agt_1',
            filePath: f,
            apiKey: 'sk'
        })
        expect(res.id).toBe('src_new')
        expect(contentType).toContain('multipart/form-data')
        expect(sentName).toBe('guide.pdf')
        expect(sentFileName).toBe('guide.pdf')
    })

    it('defaults the name field to the file basename when --name is not given, and honors an explicit name', async () => {
        const f = tmpFile('report.md', '# hi')
        let sentName = ''
        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                const form = opts.body as unknown as FormData
                sentName = String(form.get('name'))
                return { data: { id: 'src_a' } }
            })
        await uploadFileSource({ agentId: 'agt_1', filePath: f, apiKey: 'sk' })
        expect(sentName).toBe('report.md')

        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, (opts) => {
                const form = opts.body as unknown as FormData
                sentName = String(form.get('name'))
                return { data: { id: 'src_b' } }
            })
        await uploadFileSource({
            agentId: 'agt_1',
            filePath: f,
            apiKey: 'sk',
            name: 'Custom Name'
        })
        expect(sentName).toBe('Custom Name')
    })

    it('sends the actual file bytes in the file field', async () => {
        const f = tmpFile('data.txt', 'hello world')
        let text = ''
        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, async (opts) => {
                const form = opts.body as unknown as FormData
                const file = form.get('file') as File
                text = await file.text()
                return { data: { id: 'src_new' } }
            })
        await uploadFileSource({ agentId: 'agt_1', filePath: f, apiKey: 'sk' })
        expect(text).toBe('hello world')
    })

    it('PUTs to the sourceId when updating', async () => {
        const f = tmpFile('g.md', 'hello')
        mock.get('https://files.chatbase.co')
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_9',
                method: 'PUT'
            })
            .reply(200, { data: { id: 'src_9' } })
        const res = await uploadFileSource({
            agentId: 'agt_1',
            filePath: f,
            apiKey: 'sk',
            sourceId: 'src_9'
        })
        expect(res.id).toBe('src_9')
    })

    it('throws a parsed ApiError on a non-2xx response', async () => {
        const f = tmpFile('bad.pdf', 'x')
        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(413, {
                error: {
                    code: 'FILE_TOO_LARGE',
                    message: 'File exceeds the maximum size'
                }
            })
            .persist()
        const err = await uploadFileSource({
            agentId: 'agt_1',
            filePath: f,
            apiKey: 'sk'
        }).catch((e) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect(err).toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 })
    })

    it('wires the timeout signal through: a short override aborts an unresponsive request', async () => {
        const f = tmpFile('slow.pdf', 'x')
        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, { data: { id: 'src_slow' } })
            .delay(200)
        const err = await uploadFileSource({
            agentId: 'agt_1',
            filePath: f,
            apiKey: 'sk',
            timeoutMs: 5
        }).catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).name).toBe('TimeoutError')
    })

    it('retries a 429 (using X-RateLimit-Reset) and then succeeds', async () => {
        const f = tmpFile('retry.pdf', 'y')
        const pool = mock.get('https://files.chatbase.co')
        pool.intercept({
            path: '/api/v2/agents/agt_1/sources',
            method: 'POST'
        }).reply(
            429,
            { error: { code: 'RATE_LIMITED', message: 'slow down' } },
            { headers: { 'X-RateLimit-Reset': String(Date.now() + 5) } }
        )
        pool.intercept({
            path: '/api/v2/agents/agt_1/sources',
            method: 'POST'
        }).reply(201, { data: { id: 'src_retried' } })
        const res = await uploadFileSource({
            agentId: 'agt_1',
            filePath: f,
            apiKey: 'sk'
        })
        expect(res.id).toBe('src_retried')
    })

    it('does not retry a 5xx — file uploads are POST/PUT, and only 429 is retried for writes', async () => {
        const f = tmpFile('boom.pdf', 'z')
        mock.get('https://files.chatbase.co')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(500, { error: { code: 'INTERNAL', message: 'boom' } })
        const err = await uploadFileSource({
            agentId: 'agt_1',
            filePath: f,
            apiKey: 'sk'
            // No second interceptor queued: if the code retried anyway,
            // undici's MockAgent would throw "no matching interceptor"
            // instead of the ApiError asserted below.
        }).catch((e) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(500)
    })

    it('honors CHATBASE_FILES_URL as a base-url override for local dev', async () => {
        vi.stubEnv('CHATBASE_FILES_URL', 'https://files.dev.local/api/v2')
        const f = tmpFile('dev.txt', 'y')
        mock.get('https://files.dev.local')
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'POST' })
            .reply(201, { data: { id: 'src_dev' } })
        const res = await uploadFileSource({
            agentId: 'agt_1',
            filePath: f,
            apiKey: 'sk'
        })
        expect(res.id).toBe('src_dev')
    })
})
