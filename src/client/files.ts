import fs from 'node:fs'
import path from 'node:path'
import { FormData as UndiciFormData } from 'undici'
import { parseErrorResponse } from '../errors/errors.js'
import { buildUserAgent, makeFetch } from './client.js'

/** File upload host — documented at chatbase.co/docs/api-v2/sources/create-file-source */
export const FILES_BASE_URL = 'https://files.chatbase.co/api/v2'

export function resolveFilesBaseUrl(explicit?: string): string {
    if (explicit) return explicit
    const env = process.env.CHATBASE_FILES_URL
    if (env && env.length > 0) return env
    return FILES_BASE_URL
}

/**
 * The cross-environment trap: CHATBASE_API_URL points somewhere non-default
 * (a preview/staging deployment) while file uploads still go to the
 * production files host — silently sending that environment's credential to
 * a different one. Returns the warning to print, or null when the setup is
 * consistent (no API override, or an explicit CHATBASE_FILES_URL).
 */
export function filesHostMismatchWarning(): string | null {
    const apiOverride = process.env.CHATBASE_API_URL
    const filesOverride = process.env.CHATBASE_FILES_URL
    if (!apiOverride || filesOverride) return null
    return `! File uploads go to ${FILES_BASE_URL} while CHATBASE_API_URL is overridden — set CHATBASE_FILES_URL if this environment has its own files host.`
}

export async function uploadFileSource(opts: {
    agentId: string
    filePath: string
    name?: string
    apiKey: string
    sourceId?: string
    baseUrl?: string
    timeoutMs?: number
    verbose?: boolean
}): Promise<{ id: string }> {
    // Must use undici's FormData, not the global — global silently sends
    // "[object FormData]" as plain text instead of real multipart. No error.
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

    const response = await makeFetch({
        timeoutMs: opts.timeoutMs,
        verbose: opts.verbose
    })(url, {
        method,
        headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'User-Agent': buildUserAgent()
        },
        body: form
    })

    // Success body is the source object itself: { id, type, name, size, ... }
    const body = (await response.json().catch(() => undefined)) as
        | { id?: string }
        | undefined
    if (!response.ok) {
        throw parseErrorResponse(
            response.status,
            body,
            response.headers.get('x-request-id') ?? undefined
        )
    }
    const id = body?.id
    if (!id) {
        throw new Error(
            'Upload succeeded but the response did not contain a source ID'
        )
    }
    return { id }
}
