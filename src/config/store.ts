import fs from 'node:fs'
import path from 'node:path'
import { configDir, configFile } from './paths.js'

export type UserConfig = {
    apiKey?: string
    /** 'pairing' when the key was minted via browser login — logout revokes
     * those server-side. Absent for pasted keys (may be shared; local-only). */
    apiKeySource?: 'pairing'
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

/**
 * Atomic write: full JSON into a temp file, then rename over config.json.
 * A crash/Ctrl-C at any line leaves either the complete old file or the
 * complete new one — never a truncated config holding half an API key.
 *
 * Load-bearing details: the temp file MUST live in the destination
 * directory (rename is only atomic within one filesystem — /tmp may be
 * another); the PID suffix keeps concurrent CLI processes from clobbering
 * each other's in-flight writes. Modes: dir 0700 / file 0600, since this
 * file stores the credential.
 */
export function writeUserConfig(config: UserConfig): void {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 })
    const tmp = path.join(configDir(), `.config.json.tmp-${process.pid}`)
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600
    })
    fs.renameSync(tmp, configFile())
}
