import fs from 'node:fs'
import path from 'node:path'
import { configDir, configFile } from './paths.js'

export type UserConfig = {
    apiKey?: string
    agent?: string
    timeoutMs?: number
}

export function readUserConfig(): UserConfig {
    try {
        return JSON.parse(fs.readFileSync(configFile(), 'utf8')) as UserConfig
    } catch {
        return {}
    }
}

export function writeUserConfig(config: UserConfig): void {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 })
    const tmp = path.join(configDir(), `.config.json.tmp-${process.pid}`)
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600
    })
    fs.renameSync(tmp, configFile())
}
