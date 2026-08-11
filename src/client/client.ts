import os from 'node:os'
import createClient, { type Client } from 'openapi-fetch'
import {
    EnvHttpProxyAgent,
    getGlobalDispatcher,
    type RequestInit as UndiciRequestInit,
    type Response as UndiciResponse,
    fetch as undiciFetch
} from 'undici'
import { resolveTimeoutMs } from '../config/resolve.js'
import { ApiError, parseErrorResponse } from '../errors/errors.js'
import type { paths } from '../generated/api.js'
import { VERSION } from '../version.js'
import { computeRetryDelayMs, shouldRetry } from './retry.js'
import { getSigintSignal } from './signals.js'

export const DEFAULT_BASE_URL = 'https://www.chatbase.co/api/v2'

/**
 * Base-URL resolution: explicit option > CHATBASE_API_URL env > production.
 * The env override exists for developing against a local API server.
 */
export function resolveBaseUrl(explicit?: string): string {
    if (explicit) return explicit
    const env = process.env.CHATBASE_API_URL
    if (env && env.length > 0) return env
    return DEFAULT_BASE_URL
}

export type ApiClientOptions = {
    apiKey?: string
    timeoutMs?: number
    baseUrl?: string
}

export function buildUserAgent(): string {
    return `chatbase-cli/${VERSION} (${os.platform()}-${os.arch()}; node/${process.versions.node})`
}

const hasProxyEnv = () =>
    [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'http_proxy',
        'https_proxy',
        'ALL_PROXY'
    ].some((k) => process.env[k] && (process.env[k] as string).length > 0)

let proxyAgent: EnvHttpProxyAgent | undefined

function dispatcher() {
    // Node's fetch ignores HTTP(S)_PROXY by default; EnvHttpProxyAgent honors it.
    if (!hasProxyEnv()) return getGlobalDispatcher()
    proxyAgent ??= new EnvHttpProxyAgent()
    return proxyAgent
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * openapi-fetch invokes its custom `fetch` as `fetch(request, requestInitExt)`,
 * where `request` is built from the platform's global `Request` class. That is a
 * different realm/module instance than the standalone `undici` package's own
 * `Request` class, so `undici`'s internal brand-check fails to recognize it,
 * silently stringifies it, and then fails to parse a URL from "[object Request]".
 * `rawApiFetch` below calls this same function with a plain URL string instead.
 * Normalize both shapes into plain fetch args so the foreign `Request` object
 * never has to survive undici's identity check.
 */
async function toPlainRequestInit(
    input: string | URL | Request,
    init: UndiciRequestInit | undefined
): Promise<{ url: string; method: string; requestInit: UndiciRequestInit }> {
    if (typeof input === 'string' || input instanceof URL) {
        const method = (init?.method ?? 'GET').toUpperCase()
        return { url: String(input), method, requestInit: { ...init, method } }
    }
    const method = (init?.method ?? input.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    for (const [key, value] of input.headers) headers[key] = value
    const body = input.body ? Buffer.from(await input.arrayBuffer()) : undefined
    return {
        url: input.url,
        method,
        requestInit: { headers, body, ...init, method }
    }
}

function makeFetch(opts: ApiClientOptions) {
    const timeoutMs = opts.timeoutMs ?? resolveTimeoutMs()
    return async (
        input: string | URL | Request,
        init?: UndiciRequestInit
    ): Promise<UndiciResponse> => {
        const { url, method, requestInit } = await toPlainRequestInit(
            input,
            init
        )
        for (let attempt = 1; ; attempt++) {
            const response = await undiciFetch(url, {
                ...requestInit,
                dispatcher: dispatcher(),
                signal: AbortSignal.any([
                    AbortSignal.timeout(timeoutMs),
                    getSigintSignal()
                ]) as AbortSignal
            })
            if (response.ok || !shouldRetry(response.status, method, attempt))
                return response
            await sleep(
                computeRetryDelayMs(
                    attempt,
                    response.headers.get('x-ratelimit-reset'),
                    Date.now()
                )
            )
        }
    }
}

export function createApiClient(opts: ApiClientOptions = {}): Client<paths> {
    const client = createClient<paths>({
        baseUrl: resolveBaseUrl(opts.baseUrl),
        fetch: makeFetch(opts) as unknown as typeof globalThis.fetch
    })
    client.use({
        onRequest({ request }) {
            request.headers.set('User-Agent', buildUserAgent())
            if (opts.apiKey)
                request.headers.set('Authorization', `Bearer ${opts.apiKey}`)
            return request
        }
    })
    return client
}

export function throwIfError(response: Response, errorBody: unknown): void {
    if (response.ok) return
    throw parseErrorResponse(
        response.status,
        errorBody,
        response.headers.get('x-request-id') ?? undefined
    )
}

/** Untyped escape hatch — used for endpoints not yet in the vendored spec (/me) and later `chatbase api`. */
export async function rawApiFetch(
    method: string,
    path: string,
    opts: ApiClientOptions = {}
): Promise<{ status: number; requestId?: string; body: unknown }> {
    const response = await makeFetch(opts)(
        `${resolveBaseUrl(opts.baseUrl)}${path}`,
        {
            method,
            headers: {
                'User-Agent': buildUserAgent(),
                ...(opts.apiKey
                    ? { Authorization: `Bearer ${opts.apiKey}` }
                    : {})
            }
        }
    )
    let body: unknown
    try {
        body = await response.json()
    } catch {
        body = undefined
    }
    return {
        status: response.status,
        requestId: response.headers.get('x-request-id') ?? undefined,
        body
    }
}

export { ApiError }
