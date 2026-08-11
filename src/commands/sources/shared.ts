import type { Client } from 'openapi-fetch'
import { throwIfError } from '../../client/client.js'
import type { paths } from '../../generated/api.js'
import type { OutputMode } from '../../output/mode.js'
import type { Column } from '../../output/render.js'

/**
 * Stable shape a source is reduced to for display and for other commands
 * that just need "every source, minimally described" (Plan 3's `sources
 * sync` imports listAllSources() below for exactly that). Append-only:
 * existing fields must not be renamed or removed once this ships.
 */
export type SourceItem = {
    id: string
    type: string
    name: string
    size: number
    status: string
}

export const SOURCE_COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'type', header: 'TYPE' },
    { key: 'status', header: 'STATUS' },
    { key: 'size', header: 'SIZE' }
]

// The real status enum (SourceListItem.status) is just "untrained" |
// "trained" | "toBeDeleted" | "updated" (plus "deleted" on delete
// responses) — narrower than the conceptual ready/pending/failed buckets
// below. "ready"/"processing"/"training"/"error" aren't emitted by this
// endpoint today but are kept so the same glyphs read sensibly if the API
// grows finer-grained statuses later. "toBeDeleted"/"deleted" don't fit any
// bucket — they're an intentional, user-triggered state, not a failure —
// so they fall through to the raw-text default.
const READY_STATUSES = new Set(['trained', 'ready'])
const PENDING_STATUSES = new Set([
    'pending',
    'processing',
    'training',
    'untrained',
    'updated'
])
const FAILED_STATUSES = new Set(['failed', 'error'])

/**
 * Prefixes a status with a glyph, but only in pretty mode: ✓ for
 * trained/ready, … for pending/processing/training (and the real
 * untrained/updated statuses), ✗ for failed/error. Everything else — and
 * every other output mode — gets the raw status text back untouched.
 */
export function renderStatus(status: string, mode: OutputMode): string {
    if (mode !== 'pretty') return status
    const key = status.toLowerCase()
    if (READY_STATUSES.has(key)) return `✓ ${status}`
    if (PENDING_STATUSES.has(key)) return `… ${status}`
    if (FAILED_STATUSES.has(key)) return `✗ ${status}`
    return status
}

/** Maps one raw API source object to a display row for SOURCE_COLUMNS. */
export function toSourceRow(
    s: Record<string, unknown>,
    mode: OutputMode
): Record<string, string> {
    return {
        id: String(s.id ?? ''),
        name: String(s.name ?? ''),
        type: String(s.type ?? ''),
        status: renderStatus(String(s.status ?? ''), mode),
        size: String(s.size ?? '')
    }
}

type SourcesPage = {
    data: Array<Record<string, unknown>>
    pagination: { cursor?: string | null; hasMore: boolean }
}

/**
 * Walks every page of GET /agents/{agentId}/sources to the end, mapping
 * each item down to SourceItem. Consumers that need full API fidelity
 * (e.g. `sources list --json`) should page through the raw endpoint
 * themselves instead — this is for callers that only need the stable,
 * minimal shape (Plan 3's `sources sync` is the intended reuse).
 */
export async function listAllSources(
    client: Client<paths>,
    agentId: string
): Promise<SourceItem[]> {
    const items: SourceItem[] = []
    let cursor: string | undefined
    for (;;) {
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/sources',
            { params: { path: { agentId }, query: { cursor } } }
        )
        throwIfError(response, error)
        const page = data as unknown as SourcesPage
        items.push(
            ...page.data.map((s) => ({
                id: String(s.id ?? ''),
                type: String(s.type ?? ''),
                name: String(s.name ?? ''),
                size: Number(s.size ?? 0),
                status: String(s.status ?? '')
            }))
        )
        if (!page.pagination.hasMore || !page.pagination.cursor) break
        cursor = page.pagination.cursor
    }
    return items
}
