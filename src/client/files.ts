import fs from 'node:fs'
import path from 'node:path'
import {
    getGlobalDispatcher,
    FormData as UndiciFormData,
    fetch as undiciFetch
} from 'undici'
import { parseErrorResponse } from '../errors/errors.js'
import { buildUserAgent } from './client.js'
import { getSigintSignal } from './signals.js'

/**
 * File sources live on a SEPARATE service from the main API — this host is
 * not in the vendored OpenAPI spec. Every other source type (text/qna/link)
 * goes through the typed client at DEFAULT_BASE_URL; file uploads only
 * exist here, as multipart POST (create) / PUT (update).
 */
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

export async function uploadFileSource(opts: {
    agentId: string
    filePath: string
    name?: string
    apiKey: string
    sourceId?: string
    baseUrl?: string
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
    const response = await undiciFetch(url, {
        method: opts.sourceId ? 'PUT' : 'POST',
        headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'User-Agent': buildUserAgent()
        },
        body: form,
        dispatcher: getGlobalDispatcher(),
        signal: getSigintSignal()
    })
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
