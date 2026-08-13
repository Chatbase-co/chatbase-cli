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
        // setEncoding before iterating makes Node decode UTF-8 across chunk
        // boundaries; without it each Buffer chunk is coerced to a string
        // independently, corrupting multi-byte characters split mid-chunk.
        process.stdin.setEncoding('utf8')
        for await (const chunk of process.stdin) raw += chunk
    } else if (data.startsWith('@')) {
        const filePath = data.slice(1)
        if (!filePath) {
            throw new UsageError(
                '--data @ requires a filename: --data @path/to/file.json'
            )
        }
        raw = fs.readFileSync(filePath, 'utf8')
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

/**
 * Resolve a flag value into a raw string, honoring the same @file/@- indirection
 * as readBodyData but without the JSON parse — for flags like --content that
 * carry free text rather than a JSON body.
 */
export async function readTextInput(value: string): Promise<string> {
    if (value === '@-') {
        if (process.stdin.isTTY) throw new UsageError('@- expects piped stdin.')
        let raw = ''
        process.stdin.setEncoding('utf8')
        for await (const chunk of process.stdin) raw += chunk
        return raw
    }
    if (value.startsWith('@')) {
        const filePath = value.slice(1)
        if (!filePath) {
            throw new UsageError(
                '--content @ requires a filename: --content @path/to/file'
            )
        }
        return fs.readFileSync(filePath, 'utf8')
    }
    return value
}
