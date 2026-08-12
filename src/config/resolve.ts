import fs from 'node:fs'
import { UsageError } from '../errors/errors.js'
import { findProjectConfig } from './project.js'
import { readUserConfig } from './store.js'

export type Resolved = {
    value: string
    source: string
    warning?: string
}

export function resolveApiKey(): Resolved | undefined {
    const file = process.env.CHATBASE_API_KEY_FILE
    const env = process.env.CHATBASE_API_KEY
    if (file && file.length > 0) {
        let value: string
        try {
            value = fs.readFileSync(file, 'utf8').trim()
        } catch {
            throw new UsageError(
                `CHATBASE_API_KEY_FILE points to an unreadable file: ${file}`
            )
        }
        return {
            value,
            source: 'CHATBASE_API_KEY_FILE',
            warning:
                env && env.length > 0
                    ? 'Both CHATBASE_API_KEY_FILE and CHATBASE_API_KEY are set; using the file.'
                    : undefined
        }
    }
    if (env && env.length > 0) return { value: env, source: 'CHATBASE_API_KEY' }
    const stored = readUserConfig().apiKey
    if (stored) return { value: stored, source: 'user config' }
    return undefined
}

export function resolveAgent(
    flag?: string,
    cwd?: string
): Resolved | undefined {
    if (flag) return { value: flag, source: 'flag' }
    const env = process.env.CHATBASE_AGENT_ID
    if (env && env.length > 0)
        return { value: env, source: 'CHATBASE_AGENT_ID' }
    const project = findProjectConfig(cwd)
    if (project?.agent) return { value: project.agent, source: project.path }
    const stored = readUserConfig().agent
    if (stored) return { value: stored, source: 'user config' }
    return undefined
}

export function resolveTimeoutMs(): number {
    const env = process.env.CHATBASE_TIMEOUT
    if (env && /^\d+$/.test(env)) return Number(env)
    return readUserConfig().timeoutMs ?? 30000
}

/** Where resolveTimeoutMs()'s value came from — split out for `config get/list`,
 * which need to name the source without duplicating the precedence logic above. */
export function resolveTimeoutSource(): string {
    const env = process.env.CHATBASE_TIMEOUT
    if (env && /^\d+$/.test(env)) return 'CHATBASE_TIMEOUT'
    if (readUserConfig().timeoutMs !== undefined) return 'user config'
    return 'default'
}
