import fs from 'node:fs'
import { UsageError } from '../errors/errors.js'

/** Read all of stdin as a UTF-8 string, verbatim — @- must match @file's
 * fidelity (fs.readFileSync returns exact bytes too). Callers that want
 * trimmed input (a pasted key, a chat message) trim it themselves. */
export async function readStdinToEnd(): Promise<string> {
    let raw = ''
    // setEncoding before iterating makes Node decode UTF-8 across chunk
    // boundaries; without it each Buffer chunk is coerced to a string
    // independently, corrupting multi-byte characters split mid-chunk.
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) raw += chunk
    return raw
}

/**
 * Resolve @file, @- (stdin), or a literal string into its text content.
 * Shared core for both readBodyData (JSON) and readTextInput (free text).
 */
async function resolveInput(value: string, flagName: string): Promise<string> {
    if (value === '@-') {
        if (process.stdin.isTTY)
            throw new UsageError(`${flagName} @- expects piped stdin.`)
        return readStdinToEnd()
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

/** Parse -f key=value pairs into an object. Flat strings only. */
export function parseFields(fields?: string[]): Record<string, unknown> {
    if (!fields?.length) return {}
    const result: Record<string, unknown> = {}
    for (const pair of fields) {
        const eq = pair.indexOf('=')
        if (eq < 1) {
            throw new UsageError(`-f expects key=value, got "${pair}"`)
        }
        result[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
    return result
}

/** Build the request body: --data (base) → -f fields (override). */
export async function readBodyData(
    data?: string,
    fields?: string[]
): Promise<Record<string, unknown>> {
    let base: Record<string, unknown> = {}
    if (data) {
        const raw = await resolveInput(data, '--data')
        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch {
            throw new UsageError(
                '--data must be valid JSON (inline, @file, or @-).'
            )
        }
        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            Array.isArray(parsed)
        ) {
            const extra = parseFields(fields)
            if (Object.keys(extra).length > 0) {
                throw new UsageError(
                    '-f cannot be combined with a non-object --data value.'
                )
            }
            return parsed as Record<string, unknown>
        }
        base = parsed as Record<string, unknown>
    }
    return { ...base, ...parseFields(fields) }
}

/** Resolve a flag value via the same @file/@- indirection, without JSON parsing. */
export async function readTextInput(
    value: string,
    flagName = '--content'
): Promise<string> {
    return resolveInput(value, flagName)
}
