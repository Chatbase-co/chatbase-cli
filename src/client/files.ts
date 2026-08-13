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

export async function uploadFileSource(opts: {
    agentId: string
    filePath: string
    name?: string
    apiKey: string
    sourceId?: string
    baseUrl?: string
    timeoutMs?: number
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

    const response = await makeFetch({ timeoutMs: opts.timeoutMs })(url, {
        method,
        headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'User-Agent': buildUserAgent()
        },
        body: form
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
