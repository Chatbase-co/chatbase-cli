import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    resolveAgent,
    resolveApiKey,
    resolveTimeoutMs
} from '../../src/config/resolve.js'

describe('resolveApiKey', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('resolves from CHATBASE_API_KEY, then user config, else undefined', () => {
        vi.stubEnv(
            'XDG_CONFIG_HOME',
            fs.mkdtempSync(path.join(os.tmpdir(), 'cb-x-'))
        )
        vi.stubEnv('CHATBASE_API_KEY', 'sk-env')
        expect(resolveApiKey()?.source).toBe('CHATBASE_API_KEY')
        vi.stubEnv('CHATBASE_API_KEY', '')
        expect(resolveApiKey()).toBeUndefined()
    })
})

describe('resolveAgent precedence: flag > env > project > user config', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('flag wins over everything', () => {
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_env')
        expect(resolveAgent('agt_flag')?.value).toBe('agt_flag')
        expect(resolveAgent('agt_flag')?.source).toBe('flag')
    })

    it('env beats project config', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-r-'))
        fs.writeFileSync(
            path.join(root, 'chatbase.json'),
            JSON.stringify({ agent: 'agt_proj' })
        )
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_env')
        expect(resolveAgent(undefined, root)?.value).toBe('agt_env')
        vi.stubEnv('CHATBASE_AGENT_ID', '')
        const r = resolveAgent(undefined, root)
        expect(r?.value).toBe('agt_proj')
        expect(r?.source).toContain('chatbase.json')
    })
})

describe('resolveTimeoutMs', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('defaults to 30000 and honors CHATBASE_TIMEOUT', () => {
        expect(resolveTimeoutMs()).toBe(30000)
        vi.stubEnv('CHATBASE_TIMEOUT', '5000')
        expect(resolveTimeoutMs()).toBe(5000)
    })
})
