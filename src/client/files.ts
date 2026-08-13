import fs from 'node:fs'
import path from 'node:path'
import {
    FormData as UndiciFormData,
    type Response as UndiciResponse,
    fetch as undiciFetch
} from 'undici'
import { resolveTimeoutMs } from '../config/resolve.js'
import { parseErrorResponse } from '../errors/errors.js'
import { buildUserAgent, dispatcher } from './client.js'
import { computeRetryDelayMs, shouldRetry } from './retry.js'
import { getSigintSignal } from './signals.js'

/** File upload host — documented at chatbase.co/docs/api-v2/sources/create-file-source */
export const FILES_BASE_URL = 'https://files.chatbase.co/api/v2'

/**
 * Base-URL resolution mirrors resolveBaseUrl in client.ts: explicit option >
 * CHATBASE_FILES_URL env > production. The env override exists for the same
 * reason CHATBASE_API_URL does — pointing local dev at a dev files host.
 */
export function resolveFilesBaseUrl(explicit?: string): string {
    if (explicit) return explicit
    const env = process.env.CHATBASE_FILES_URL
    if (env && env.length > 0) return env
    return FILES_BASE_URL
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function uploadFileSource(opts: {
    agentId: string
    filePath: string
    name?: string
    apiKey: string
    sourceId?: string
    baseUrl?: string
    /** Overrides resolveTimeoutMs() — mainly for tests exercising the abort path. */
    timeoutMs?: number
}): Promise<{ id: string }> {
    // undici's fetch() only recognizes ITS OWN FormData class as a
    // multipart-capable body. Node's ambient global FormData is a distinct
    // class (same cross-realm trap as the Request-normalization comment in
    // client.ts) — handing fetch() a global FormData silently degrades to a
    // stringified "[object FormData]" text/plain body instead of real
    // multipart, with no error. Confirmed empirically against undici 7.29;
    // must import FormData from 'undici', not rely on the ambient global.
    const form = new UndiciFormData()
    const buffer = fs.readFileSync(opts.filePath)
    const filename = path.basename(opts.filePath)
    form.set('name', opts.name ?? filename)
    form.set('file', new Blob([buffer]), filename)
    const base = resolveFilesBaseUrl(opts.baseUrl)
    const url = opts.sourceId
        ? `${base}/agents/${opts.agentId}/sources/${opts.sourceId}`
        : `${base}/agents/${opts.agentId}/sources`
    const method = opts.sourceId ? 'PUT' : 'POST'
    const timeoutMs = opts.timeoutMs ?? resolveTimeoutMs()

    // Same proxy/timeout/retry treatment as makeFetch() in client.ts — file
    // uploads previously bypassed all three by calling undiciFetch directly
    // with a bare getGlobalDispatcher()/getSigintSignal(). Only 429 is
    // retried here: these requests are POST/PUT, and shouldRetry() only
    // retries 5xx for GET (a write may have half-completed server-side
    // before failing, so repeating it isn't safe).
    let response: UndiciResponse
    for (let attempt = 1; ; attempt++) {
        response = await undiciFetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${opts.apiKey}`,
                'User-Agent': buildUserAgent()
            },
            body: form,
            dispatcher: dispatcher(),
            signal: AbortSignal.any([
                AbortSignal.timeout(timeoutMs),
                getSigintSignal()
            ]) as AbortSignal
        })
        if (response.ok || !shouldRetry(response.status, method, attempt)) break
        // Draining before the retry avoids leaking the unread response
        // body's underlying connection while we sleep and loop.
        await response.body?.cancel()
        await sleep(
            computeRetryDelayMs(
                attempt,
                response.headers.get('x-ratelimit-reset'),
                Date.now()
            )
        )
    }

    const body = (await response.json().catch(() => undefined)) as
        | { data?: { id: string } }
        | undefined
    if (!response.ok) {
        throw parseErrorResponse(
            response.status,
            body,
            response.headers.get('x-request-id') ?? undefined
        )
    }
    return { id: body?.data?.id ?? '' }
}
