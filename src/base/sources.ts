import type { Client } from 'openapi-fetch'
import { fetchAllPages } from '../client/paginate.js'
import type { paths } from '../generated/api.js'
import type { OutputMode } from '../output/mode.js'
import type { Column } from '../output/render.js'

/** Minimal source shape shared by display commands and `sources sync`. */
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

const READY = new Set(['trained'])
const PENDING = new Set(['untrained', 'updated'])

/** Pretty-mode glyph: ✓ trained, … untrained/updated, raw text for everything else. */
export function renderStatus(status: string, mode: OutputMode): string {
    if (mode !== 'pretty') return status
    const key = status.toLowerCase()
    if (READY.has(key)) return `✓ ${status}`
    if (PENDING.has(key)) return `… ${status}`
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

/**
 * Walks every page of GET /agents/{agentId}/sources to the end, mapping
 * each item down to SourceItem. Consumers that need full API fidelity
 * (e.g. `sources list --json`) should page through the raw endpoint
 * themselves instead — this is for callers that only need the stable,
 * minimal shape (`sources sync` is the primary consumer).
 */
export async function listAllSources(
    client: Client<paths>,
    agentId: string
): Promise<SourceItem[]> {
    const { items } = await fetchAllPages<Record<string, unknown>>(
        (query) =>
            client.GET('/agents/{agentId}/sources', {
                params: { path: { agentId }, query }
            }),
        { all: true }
    )
    return items.map((s) => ({
        id: String(s.id ?? ''),
        type: String(s.type ?? ''),
        name: String(s.name ?? ''),
        size: Number(s.size ?? 0),
        status: String(s.status ?? '')
    }))
}
