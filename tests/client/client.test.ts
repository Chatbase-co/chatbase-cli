import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    buildUserAgent,
    createApiClient,
    rawApiFetch
} from '../../src/client/client.js'
import { ApiError } from '../../src/errors/errors.js'
import { VERSION } from '../../src/version.js'

const BASE = 'https://www.chatbase.co'

let mock: MockAgent

// undici's MockResponseDataHandler receives request info (including headers) as its
// first argument in this installed version, rather than binding `this` — see
// mock-utils.js `_data({ ...opts, headers: optsHeaders })`. Read headers from there.
// Typed as `unknown` and duck-typed rather than pinned to a `Headers` class: the
// installed undici's own `Headers` type is a distinct nominal type from the
// ambient global `Headers`, and the two are not assignable to one another.
function headerValue(headers: unknown, name: string): string {
    if (!headers) return ''
    const maybeHeadersLike = headers as {
        get?: (name: string) => string | null
    }
    if (typeof maybeHeadersLike.get === 'function')
        return maybeHeadersLike.get(name) ?? ''
    const record = headers as Record<string, string>
    return record[name] ?? record[name.toLowerCase()] ?? ''
}

// The mock reply callback's `opts.body` may arrive as a string, Buffer, or
// Uint8Array depending on how the request body was read off the wire.
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
})

afterEach(async () => {
    await mock.close()
})

describe('createApiClient', () => {
    it('sends Authorization and a spec-compliant User-Agent', async () => {
        let seenAuth = ''
        let seenUa = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/health',
                method: 'GET'
            })
            .reply(200, (opts) => {
                seenAuth = headerValue(opts.headers, 'authorization')
                seenUa = headerValue(opts.headers, 'user-agent')
                return { status: 'ok', timestamp: 1 }
            })
        const client = createApiClient({ apiKey: 'sk-test' })
        const { data } = await client.GET('/health')
        expect(data?.status).toBe('ok')
        expect(seenAuth).toBe('Bearer sk-test')
        expect(seenUa).toBe(buildUserAgent())
        expect(buildUserAgent()).toMatch(
            new RegExp(`^chatbase-cli/${VERSION} \\(.+; node/.+\\)$`)
        )
    })

    it('retries 429 using X-RateLimit-Reset and then succeeds', async () => {
        const pool = mock.get(BASE)
        pool.intercept({ path: '/api/v2/health', method: 'GET' }).reply(
            429,
            { error: { code: 'RATE_LIMITED', message: 'slow down' } },
            {
                headers: { 'X-RateLimit-Reset': String(Date.now() + 20) }
            }
        )
        pool.intercept({ path: '/api/v2/health', method: 'GET' }).reply(200, {
            status: 'ok',
            timestamp: 1
        })
        const client = createApiClient({ apiKey: 'sk-test' })
        const { data, response } = await client.GET('/health')
        expect(response.status).toBe(200)
        expect(data?.status).toBe('ok')
    })

    it('sends a POST with a JSON body as POST on the wire (not silently downgraded to GET)', async () => {
        let seenMethod = ''
        let seenBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'POST' })
            .reply(201, (opts) => {
                seenMethod = opts.method
                seenBody = bodyText(opts.body)
                return { id: 'agent_test' }
            })
        const client = createApiClient({ apiKey: 'sk-test' })
        const { data, response } = await client.POST('/agents', {
            body: { name: 'Test Agent' }
        })
        expect(response.status).toBe(201)
        expect(data?.id).toBe('agent_test')
        expect(seenMethod).toBe('POST')
        expect(JSON.parse(seenBody)).toEqual({ name: 'Test Agent' })
    })
})

describe('rawApiFetch', () => {
    it('returns status, parsed body, and x-request-id', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/me', method: 'GET' })
            .reply(
                401,
                {
                    error: {
                        code: 'AUTH_INVALID_API_KEY',
                        message: 'Invalid API key'
                    }
                },
                {
                    headers: { 'x-request-id': 'req_raw' }
                }
            )
        const res = await rawApiFetch('GET', '/me', { apiKey: 'sk-bad' })
        expect(res.status).toBe(401)
        expect(res.requestId).toBe('req_raw')
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'AUTH_INVALID_API_KEY'
        )
    })
})

describe('throwIfError helper via client usage', () => {
    it('produces an ApiError carrying the request id', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/health', method: 'GET' })
            .reply(
                500,
                { error: { code: 'INTERNAL', message: 'boom' } },
                { headers: { 'x-request-id': 'req_e' } }
            )
        // 5xx GET retries once, so queue the same response again:
        mock.get(BASE)
            .intercept({ path: '/api/v2/health', method: 'GET' })
            .reply(
                500,
                { error: { code: 'INTERNAL', message: 'boom' } },
                { headers: { 'x-request-id': 'req_e' } }
            )
        const client = createApiClient({ apiKey: 'sk' })
        const { error, response } = await client.GET('/health')
        const { throwIfError } = await import('../../src/client/client.js')
        expect(() => throwIfError(response, error)).toThrow(ApiError)
        try {
            throwIfError(response, error)
        } catch (e) {
            expect((e as ApiError).requestId).toBe('req_e')
            expect((e as ApiError).status).toBe(500)
        }
    })
})
