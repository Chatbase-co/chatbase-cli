import fs from 'node:fs'
import path from 'node:path'
import { UsageError } from '../errors/errors.js'

export type ProjectConfig = {
    agent?: string
    path: string
}

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
