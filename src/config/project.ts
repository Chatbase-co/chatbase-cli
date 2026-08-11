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
const SECRET_KEYS = [
    'apikey',
    'api_key',
    'apikeyfile',
    'key',
    'token',
    'secret'
]

export function findProjectConfig(
    startDir: string = process.cwd()
): ProjectConfig | undefined {
    let dir = path.resolve(startDir)
    for (;;) {
        const candidate = path.join(dir, 'chatbase.json')
        if (fs.existsSync(candidate)) {
            let raw: Record<string, unknown>
            try {
                raw = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<
                    string,
                    unknown
                >
            } catch {
                throw new UsageError(`${candidate} is not valid JSON`)
            }
            const offending = Object.keys(raw).find((k) =>
                SECRET_KEYS.includes(k.toLowerCase())
            )
            if (offending) {
                throw new UsageError(
                    `${candidate} contains "${offending}" — never store secrets in project config. ` +
                        'chatbase.json is designed to be committed; use `chatbase auth login` or CHATBASE_API_KEY instead.'
                )
            }
            return {
                agent: typeof raw.agent === 'string' ? raw.agent : undefined,
                path: candidate
            }
        }
        const parent = path.dirname(dir)
        if (parent === dir) return undefined
        dir = parent
    }
}
