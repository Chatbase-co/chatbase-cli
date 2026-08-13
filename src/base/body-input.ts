import fs from 'node:fs'
import { UsageError } from '../errors/errors.js'

/**
 * Resolve @file, @- (stdin), or a literal string into its text content.
 * Shared core for both readBodyData (JSON) and readTextInput (free text).
 */
async function resolveInput(value: string, flagName: string): Promise<string> {
    if (value === '@-') {
        if (process.stdin.isTTY)
            throw new UsageError(`${flagName} @- expects piped stdin.`)
        let raw = ''
        // setEncoding before iterating makes Node decode UTF-8 across chunk
        // boundaries; without it each Buffer chunk is coerced to a string
        // independently, corrupting multi-byte characters split mid-chunk.
        process.stdin.setEncoding('utf8')
        for await (const chunk of process.stdin) raw += chunk
        return raw
    }
    if (value.startsWith('@')) {
        const filePath = value.slice(1)
        if (!filePath) {
            throw new UsageError(
                `${flagName} @ requires a filename: ${flagName} @path/to/file`
            )
        }
        return fs.readFileSync(filePath, 'utf8')
    }
    return value
}

/** Resolve --data into an object: @file.json, @- (stdin), or inline JSON. */
export async function readBodyData(
    data?: string
): Promise<Record<string, unknown>> {
    if (!data) return {}
    const raw = await resolveInput(data, '--data')
    try {
        return JSON.parse(raw) as Record<string, unknown>
    } catch {
        throw new UsageError(
            '--data must be valid JSON (inline, @file, or @-).'
        )
    }
}

/** Resolve a flag value via the same @file/@- indirection, without JSON parsing. */
export async function readTextInput(value: string): Promise<string> {
    return resolveInput(value, '--content')
}
