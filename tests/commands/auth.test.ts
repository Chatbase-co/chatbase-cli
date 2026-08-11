import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from '../../src/commands/auth/login.js'
import Logout from '../../src/commands/auth/logout.js'
import Status from '../../src/commands/auth/status.js'
import { readUserConfig } from '../../src/config/store.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-auth-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

function stubStdinToken(token: string) {
    // login --with-token reads stdin to end
    const stdin = Readable.from([
        `${token}\n`
    ]) as unknown as NodeJS.ReadStream & { fd: 0 }
    Object.defineProperty(stdin, 'isTTY', { value: false })
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)
}

describe('auth login --with-token', () => {
    it('verifies via /me and stores the key', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/me', method: 'GET' })
            .reply(200, {
                workspace: { id: 'w1', name: 'Acme' },
                plan: 'standard'
            })
        stubStdinToken('sk-live-1234')
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Login.run(['--with-token'], process.cwd())
        expect(readUserConfig().apiKey).toBe('sk-live-1234')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'Acme'
        )
    })

    it('stores unverified when /me does not exist yet (404)', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/me', method: 'GET' })
            .reply(404, { error: { code: 'NOT_FOUND', message: 'no' } })
        stubStdinToken('sk-live-x')
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Login.run(['--with-token'], process.cwd())
        expect(readUserConfig().apiKey).toBe('sk-live-x')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toMatch(
            /verification unavailable/i
        )
    })

    it('rejects and does NOT store on 401', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/me', method: 'GET' })
            .reply(401, {
                error: {
                    code: 'AUTH_INVALID_API_KEY',
                    message: 'Invalid API key'
                }
            })
        stubStdinToken('sk-bad')
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Login.run(['--with-token'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(readUserConfig().apiKey).toBeUndefined()
    })

    it('errors instead of hanging when stdin is a TTY', {
        timeout: 2000
    }, async () => {
        // A TTY stdin that never ends: the command must not block on it
        const stdin = new Readable({
            read() {}
        }) as unknown as NodeJS.ReadStream & { fd: 0 }
        Object.defineProperty(stdin, 'isTTY', { value: true })
        vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Login.run(['--with-token'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('refuses to prompt with --no-input and no token', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Login.run(['--no-input'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('auth status with CHATBASE_API_URL override', () => {
    it('warns loudly when the API base is not production', async () => {
        vi.stubEnv('CHATBASE_API_URL', 'http://localhost:3000/api/v2')
        vi.stubEnv('CHATBASE_API_KEY', 'sk-env-abcd')
        mock.get('http://localhost:3000')
            .intercept({ path: '/api/v2/me', method: 'GET' })
            .reply(404, {})
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Status.run([], process.cwd())
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('API base overridden')
        expect(text).toContain('http://localhost:3000/api/v2')
    })
})

describe('auth logout / status', () => {
    it('logout removes the stored key', async () => {
        const { writeUserConfig } = await import('../../src/config/store.js')
        writeUserConfig({ apiKey: 'sk-z' })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Logout.run([], process.cwd())
        expect(readUserConfig().apiKey).toBeUndefined()
    })

    it('status names the credential source and masks the key', async () => {
        vi.stubEnv('CHATBASE_API_KEY', 'sk-env-abcd')
        mock.get(BASE)
            .intercept({ path: '/api/v2/me', method: 'GET' })
            .reply(404, {})
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Status.run([], process.cwd())
        const outText = err.mock.calls.map((c) => String(c[0])).join('')
        expect(outText).toContain('CHATBASE_API_KEY')
        expect(outText).toContain('…abcd')
        expect(outText).not.toContain('sk-env-abcd')
    })
})
