import fs from 'node:fs'
import { UsageError } from '../errors/errors.js'

/** Resolve --data into an object: @file.json, @- (stdin), or inline JSON. */
export async function readBodyData(
    data?: string
): Promise<Record<string, unknown>> {
    if (!data) return {}
    let raw: string
    if (data === '@-') {
        if (process.stdin.isTTY)
            throw new UsageError('--data @- expects piped stdin.')
        raw = ''
        for await (const chunk of process.stdin) raw += chunk
    } else if (data.startsWith('@')) {
        raw = fs.readFileSync(data.slice(1), 'utf8')
    } else {
        raw = data
    }
    try {
        return JSON.parse(raw) as Record<string, unknown>
    } catch {
        throw new UsageError(
            '--data must be valid JSON (inline, @file, or @-).'
        )
    }
}
