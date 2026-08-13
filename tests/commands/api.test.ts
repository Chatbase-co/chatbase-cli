import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Api from '../../src/commands/api.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

// See tests/client/client.test.ts's identical helper for why: the installed
// undici's MockResponseDataHandler hands back request headers in a shape
// that isn't the ambient global `Headers` type, so duck-type instead.
function headerValue(headers: unknown, name: string): string {
    if (!headers) return ''
    const maybeHeadersLike = headers as {
        get?: (name: string) => string | null
    }
    if (typeof maybeHeadersLike.get === 'function')
        return maybeHeadersLike.get(name) ?? ''
    // rawApiFetch passes a plain object (not a Headers instance) through to
    // undici, which preserves whatever casing we wrote ("Content-Type") —
    // unlike the createApiClient path, which goes through a real Headers
    // object and always normalizes to lowercase. Search case-insensitively.
    const record = headers as Record<string, string>
    const key = Object.keys(record).find(
        (k) => k.toLowerCase() === name.toLowerCase()
    )
    return key ? record[key] : ''
}

function bodyText(body: unknown): string {
    if (body == null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
    return String(body)
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-api-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase api', () => {
    it('GET passes --field pairs as query params and prints raw JSON to stdout', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents',
                method: 'GET',
                query: { limit: '5' }
            })
            .reply(200, { data: [] })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await Api.run(['GET', '/agents', '--query', 'limit=5'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual({ data: [] })
    })

    it('supports repeated --field for multiple query params', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents',
                method: 'GET',
                query: { limit: '5', cursor: 'cur_1' }
            })
            .reply(200, { data: [] })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await Api.run(
            ['GET', '/agents', '--query', 'limit=5', '--query', 'cursor=cur_1'],
            process.cwd()
        )
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual({ data: [] })
    })

    it('POST sends an inline --body as the JSON request body', async () => {
        let seenBody = ''
        let seenContentType = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'POST' })
            .reply(201, (opts) => {
                seenBody = bodyText(opts.body)
                seenContentType = headerValue(opts.headers, 'content-type')
                return { id: 'agt_new' }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await Api.run(
            ['POST', '/agents', '--body', '{"name":"Test"}'],
            process.cwd()
        )
        expect(JSON.parse(seenBody)).toEqual({ name: 'Test' })
        expect(seenContentType).toContain('application/json')
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual({ id: 'agt_new' })
    })

    it('a GET with no --body sends no request body at all', async () => {
        let seenBody = 'untouched'
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, (opts) => {
                seenBody = bodyText(opts.body)
                return { data: [] }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await Api.run(['GET', '/agents'], process.cwd())
        expect(seenBody).toBe('')
    })

    it('exits 1 with the standard ApiError rendering on non-2xx', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/missing', method: 'GET' })
            .reply(404, {
                error: { code: 'NOT_FOUND', message: 'no such agent' }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Api.run(['GET', '/agents/missing'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'NOT_FOUND'
        )
    })

    it('rejects an invalid method before making any request', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Api.run(['FOOBAR', '/agents'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('rejects a --field without "="', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Api.run(['GET', '/agents', '--query', 'nope'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('requires authentication', async () => {
        vi.unstubAllEnvs()
        vi.stubEnv(
            'XDG_CONFIG_HOME',
            fs.mkdtempSync(path.join(os.tmpdir(), 'cb-api-noauth-'))
        )
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Api.run(['GET', '/agents'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})
