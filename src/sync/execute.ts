import type { Client } from 'openapi-fetch'
import { throwIfError } from '../client/client.js'
import { uploadFileSource } from '../client/files.js'
import { ApiError } from '../errors/errors.js'
import type { paths } from '../generated/api.js'
import type { SyncPlan } from './diff.js'

export type SyncFailure = { name: string; error: string }

export type ExecuteSyncDeps = {
    agentId: string
    apiKey: string
    client: Client<paths>
    /** Max concurrent operations in the pool. Defaults to 4. */
    concurrency?: number
    onProgress: (line: string) => void
    /** --verbose: forwarded to the upload client's request logging. */
    verbose?: boolean
}

export type ExecuteSyncResult = {
    failures: SyncFailure[]
    applied: number
}

/**
 * Runs up to `n` `worker` calls concurrently over `items`, using a simple
 * shared-cursor pool: each of the `n` slots repeatedly pulls the next item
 * and awaits its own worker call before pulling again. No dependency and no
 * queue object — the cursor itself is the only shared state.
 */
async function pool<T>(
    items: T[],
    n: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let next = 0
    async function runSlot(): Promise<void> {
        for (;;) {
            const i = next++
            if (i >= items.length) return
            await worker(items[i] as T)
        }
    }
    const slots = Array.from({ length: Math.min(n, items.length) }, runSlot)
    await Promise.all(slots)
}

function errorMessage(err: unknown): string {
    // ApiErrors carry the code and request id engineering needs to
    // correlate a failed file against server-side logs — keep them.
    if (err instanceof ApiError) {
        const parts = [`${err.message} (${err.code})`]
        if (err.requestId) parts.push(`request id: ${err.requestId}`)
        return parts.join(' — ')
    }
    return err instanceof Error ? err.message : String(err)
}

type UploadItem = { name: string; filePath: string; sourceId?: string }

/**
 * Applies a `SyncPlan`: creates and updates are uploaded (via
 * `uploadFileSource`, concurrency-limited) and deletes are then issued
 * through the typed client, also pool-limited. Every completed operation
 * (success or failure) calls `onProgress` exactly once with a short status
 * line. Failures are collected rather than thrown — the returned promise
 * always resolves, so a handful of bad files never aborts the rest of the
 * sync. `applied` is every attempted operation minus the failed ones.
 */
export async function executeSyncPlan(
    plan: SyncPlan,
    deps: ExecuteSyncDeps
): Promise<ExecuteSyncResult> {
    const concurrency = deps.concurrency ?? 4
    const failures: SyncFailure[] = []
    let attempted = 0

    const uploads: UploadItem[] = [
        ...plan.create.map((f) => ({ name: f.relPath, filePath: f.absPath })),
        ...plan.update.map((f) => ({
            name: f.relPath,
            filePath: f.absPath,
            sourceId: f.sourceId
        }))
    ]

    await pool(uploads, concurrency, async (item) => {
        attempted++
        const prefix = item.sourceId ? '~' : '+'
        try {
            await uploadFileSource({
                agentId: deps.agentId,
                filePath: item.filePath,
                name: item.name,
                apiKey: deps.apiKey,
                sourceId: item.sourceId,
                verbose: deps.verbose
            })
            deps.onProgress(`${prefix} ${item.name}`)
        } catch (err) {
            const message = errorMessage(err)
            failures.push({ name: item.name, error: message })
            deps.onProgress(`✗ ${item.name}: ${message}`)
        }
    })

    await pool(plan.del, concurrency, async (item) => {
        attempted++
        try {
            const { error, response } = await deps.client.DELETE(
                '/agents/{agentId}/sources/{sourceId}',
                {
                    params: {
                        path: { agentId: deps.agentId, sourceId: item.sourceId }
                    }
                }
            )
            throwIfError(response, error)
            deps.onProgress(`− ${item.name}`)
        } catch (err) {
            const message = errorMessage(err)
            failures.push({ name: item.name, error: message })
            deps.onProgress(`✗ ${item.name}: ${message}`)
        }
    })

    return { failures, applied: attempted - failures.length }
}
