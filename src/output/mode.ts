export type OutputMode = 'pretty' | 'plain' | 'json'

export function selectMode(
    flags: { json?: boolean; plain?: boolean },
    stream: { isTTY?: boolean } = process.stdout
): OutputMode {
    if (flags.json) return 'json'
    if (flags.plain) return 'plain'
    return stream.isTTY ? 'pretty' : 'plain'
}
