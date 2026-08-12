/**
 * Reader for `chatbase.json` — a file OUR USERS commit to THEIR project
 * repos to share settings with teammates and CI ("this repo talks to agent
 * X"), the way package.json pins a project's dependencies. Discovered by
 * walking up from the working directory, git-style, so commands work from
 * any subdirectory; absence is normal, not an error.
 *
 * Sits third in the precedence chain: flag > env > this file > user config.
 *
 * Because this file is designed to be committed, a credential typed into
 * it enters git history — effectively public forever. SECRET_KEYS below
 * turns that silent leak into a loud refusal at the moment of the mistake.
 */
import fs from 'node:fs'
import path from 'node:path'
import { UsageError } from '../errors/errors.js'

export type ProjectConfig = {
    agent?: string
    path: string
    sync?: { dir?: string; include?: string[]; exclude?: string[] }
}

/**
 * Property names people reach for when about to commit a credential:
 * apikey/api_key = our credential's obvious name; apikeyfile = mirroring
 * the CHATBASE_API_KEY_FILE env var into JSON; key/token/secret = the
 * generic names across ecosystems.
 *
 * This is a tripwire, not a scanner: it checks top-level key NAMES only —
 * nested objects or key-shaped VALUES under innocent names pass through.
 * Accepted trade: catches the overwhelmingly common form of the mistake
 * in ~10 lines. 'key' is deliberately over-broad — a false refusal costs
 * the user a rename; a leaked credential costs a rotation.
 */
const SECRET_KEYS = new Set([
    'apikey',
    'api_key',
    'apikeyfile',
    'key',
    'token',
    'secret'
])

/** Read a file if it exists; undefined when it (or its directory) doesn't. */
function tryReadFile(filePath: string): string | undefined {
    try {
        return fs.readFileSync(filePath, 'utf8')
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
            return undefined
        }
        throw err
    }
}

/** Narrows an array to just its string elements — used for `sync.include`/
 * `sync.exclude`, which are silently filtered rather than rejected when a
 * project file has a stray non-string entry (a typo shouldn't be a hard
 * failure for a glob list). */
function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    return value.filter((v): v is string => typeof v === 'string')
}

/**
 * Parses the optional `sync` block. Malformed fields (wrong type) are
 * dropped rather than thrown — `chatbase.json` is a committed, shared file,
 * and a typo in `sync.dir` shouldn't block every other command that reads
 * this file (e.g. agent resolution) from working.
 */
function parseSyncConfig(value: unknown): ProjectConfig['sync'] {
    if (typeof value !== 'object' || value === null) return undefined
    const raw = value as Record<string, unknown>
    const dir = typeof raw.dir === 'string' ? raw.dir : undefined
    const include = stringArray(raw.include)
    const exclude = stringArray(raw.exclude)
    if (dir === undefined && include === undefined && exclude === undefined) {
        return undefined
    }
    return { dir, include, exclude }
}

/** Parse + validate one chatbase.json whose contents are already in hand. */
function parseProjectConfig(contents: string, filePath: string): ProjectConfig {
    let raw: Record<string, unknown>
    try {
        raw = JSON.parse(contents) as Record<string, unknown>
    } catch {
        throw new UsageError(`${filePath} is not valid JSON`)
    }
    const secretLikeKey = Object.keys(raw).find((k) =>
        SECRET_KEYS.has(k.toLowerCase())
    )
    if (secretLikeKey) {
        throw new UsageError(
            `${filePath} contains "${secretLikeKey}" — never store secrets in project config. ` +
                'chatbase.json is designed to be committed; use `chatbase auth login` or CHATBASE_API_KEY instead.'
        )
    }
    return {
        agent: typeof raw.agent === 'string' ? raw.agent : undefined,
        path: filePath,
        sync: parseSyncConfig(raw.sync)
    }
}

export function findProjectConfig(
    startDir: string = process.cwd()
): ProjectConfig | undefined {
    let dir = path.resolve(startDir)
    for (;;) {
        const candidate = path.join(dir, 'chatbase.json')
        const contents = tryReadFile(candidate)
        if (contents !== undefined) {
            return parseProjectConfig(contents, candidate)
        }
        const parent = path.dirname(dir)
        if (parent === dir) return undefined
        dir = parent
    }
}
