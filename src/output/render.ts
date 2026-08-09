export type Column = { key: string; header: string }

export function renderTable(
    rows: Record<string, string>[],
    columns: Column[]
): string {
    const widths = columns.map((c) =>
        Math.max(c.header.length, ...rows.map((r) => (r[c.key] ?? '').length))
    )
    const line = (cells: string[]) =>
        cells
            .map((cell, i) =>
                i === cells.length - 1 ? cell : cell.padEnd(widths[i] + 2)
            )
            .join('')
            .trimEnd()
    return [
        line(columns.map((c) => c.header)),
        ...rows.map((r) => line(columns.map((c) => r[c.key] ?? '')))
    ].join('\n')
}

export function renderPlain(
    rows: Record<string, string>[],
    columns: Column[]
): string {
    return rows
        .map((r) => columns.map((c) => r[c.key] ?? '').join('\t'))
        .join('\n')
}
