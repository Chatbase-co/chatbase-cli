import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

function withTempConfigHome() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-'))
    vi.stubEnv('XDG_CONFIG_HOME', dir)
    return dir
}

describe('user config store', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('round-trips config and writes with 0600 permissions', async () => {
        const dir = withTempConfigHome()
        const { readUserConfig, writeUserConfig } = await import(
            '../../src/config/store.js'
        )
        writeUserConfig({ apiKey: 'sk-test', agent: 'agt_1' })
        expect(readUserConfig()).toEqual({ apiKey: 'sk-test', agent: 'agt_1' })
        const file = path.join(dir, 'chatbase', 'config.json')
        if (process.platform !== 'win32') {
            const mode = fs.statSync(file).mode & 0o777
            expect(mode).toBe(0o600)
        }
    })

    it('returns {} when no config exists', async () => {
        withTempConfigHome()
        const { readUserConfig } = await import('../../src/config/store.js')
        expect(readUserConfig()).toEqual({})
    })

    it('leaves no temp files behind (atomic write)', async () => {
        const dir = withTempConfigHome()
        const { writeUserConfig } = await import('../../src/config/store.js')
        writeUserConfig({ agent: 'x' })
        const files = fs.readdirSync(path.join(dir, 'chatbase'))
        expect(files).toEqual(['config.json'])
    })
})
