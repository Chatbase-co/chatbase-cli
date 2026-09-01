import type { OutputMode } from '../output/mode.js'
import type { Column } from '../output/render.js'

export const SOURCE_COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'type', header: 'TYPE' },
    { key: 'status', header: 'STATUS' },
    { key: 'size', header: 'SIZE' }
]

const READY = new Set(['trained'])
const PENDING = new Set(['untrained', 'updated', 'toBeDeleted'])
const REMOVED = new Set(['deleted'])

/** Pretty-mode glyph: ✓ trained, … in progress, ✗ deleted. */
export function renderStatus(status: string, mode: OutputMode): string {
    if (mode !== 'pretty') return status
    const key = status.toLowerCase()
    if (READY.has(key)) return `✓ ${status}`
    if (PENDING.has(key)) return `… ${status}`
    if (REMOVED.has(key)) return `✗ ${status}`
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
