import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { select } from '@inquirer/prompts'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConfigGet from '../../src/commands/config/get.js'
import ConfigList from '../../src/commands/config/list.js'
import ConfigSet from '../../src/commands/config/set.js'
import { readUserConfig } from '../../src/config/store.js'

vi.mock('@inquirer/prompts', () => ({ select: vi.fn() }))

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-config-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

function stubTTY() {
    const stdin = new Readable({
        read() {}
    }) as unknown as NodeJS.ReadStream & { fd: 0 }
    Object.defineProperty(stdin, 'isTTY', { value: true })
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)
}

describe('config set apiKey is refused', () => {
    it('rejects apiKey', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['apiKey', 'sk-x'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(readUserConfig().apiKey).toBeUndefined()
    })

    it('rejects every casing of the key', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['API_KEY', 'sk-x'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        await expect(
            ConfigSet.run(['apikey', 'sk-x'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('points at auth login', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['apiKey', 'sk-x'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'auth login'
        )
    })
})

describe('config list names each value source', () => {
    it('names CHATBASE_AGENT_ID as the agent source', async () => {
        vi.stubEnv('CHATBASE_AGENT_ID', 'agt_env')
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConfigList.run([], process.cwd())
        expect(err.mock.calls.join('')).toContain('CHATBASE_AGENT_ID')
    })

    it('names the timeout source', async () => {
        vi.stubEnv('CHATBASE_TIMEOUT', '9999')
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConfigList.run([], process.cwd())
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('CHATBASE_TIMEOUT')
        expect(text).toContain('9999')
    })

    it('reports <not set> when the agent has no source at all', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConfigList.run([], process.cwd())
        expect(err.mock.calls.join('')).toContain('<not set>')
    })
})

describe('config set + get round trip', () => {
    it('agent: set then get returns the same value and names its source', async () => {
        // vi.spyOn() on an already-spied method returns the SAME mock
        // rather than layering a new one — reuse these two spies and clear
        // them between the set and get phases instead of re-spying.
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConfigSet.run(['agent', 'agt_123'], process.cwd())
        expect(readUserConfig().agent).toBe('agt_123')

        out.mockClear()
        err.mockClear()
        await ConfigGet.run(['agent'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'agt_123\n'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'user config'
        )
    })

    it('timeout: set then get returns the same value', async () => {
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConfigSet.run(['timeout', '45000'], process.cwd())
        expect(readUserConfig().timeoutMs).toBe(45000)

        out.mockClear()
        await ConfigGet.run(['timeout'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe('45000\n')
    })

    it('rejects a non-numeric timeout', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['timeout', 'soon'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('rejects timeout 0 (AbortSignal.timeout(0) would fire immediately and break every command)', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['timeout', '0'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(readUserConfig().timeoutMs).toBeUndefined()
    })

    it('config get rejects an unknown key', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigGet.run(['bogus'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('config set rejects an unknown key', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['bogus', 'x'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('config set agent (no value)', () => {
    it('refuses to prompt without a TTY', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['agent'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('refuses to prompt with --no-input even on a TTY', async () => {
        stubTTY()
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['agent', '--no-input'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('on a TTY, fetches GET /agents and stores the selected id', async () => {
        vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
        stubTTY()
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [
                    { id: 'agt_1', name: 'Support Bot' },
                    { id: 'agt_2', name: 'Sales Bot' }
                ],
                pagination: { cursor: null, hasMore: false, total: 2 }
            })
        vi.mocked(select).mockResolvedValue('agt_2' as never)
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConfigSet.run(['agent'], process.cwd())
        expect(readUserConfig().agent).toBe('agt_2')
        expect(vi.mocked(select)).toHaveBeenCalledWith(
            expect.objectContaining({
                choices: [
                    expect.objectContaining({ value: 'agt_1' }),
                    expect.objectContaining({ value: 'agt_2' })
                ]
            })
        )
    })

    it('follows pagination to the end and offers every agent, not just the first page', async () => {
        vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
        stubTTY()
        const pool = mock.get(BASE)
        pool.intercept({ path: '/api/v2/agents', method: 'GET' }).reply(200, {
            data: [{ id: 'agt_1', name: 'Support Bot' }],
            pagination: { cursor: 'cur_2', hasMore: true, total: 2 }
        })
        pool.intercept({
            path: '/api/v2/agents',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, {
            data: [{ id: 'agt_2', name: 'Sales Bot' }],
            pagination: { cursor: null, hasMore: false, total: 2 }
        })
        vi.mocked(select).mockResolvedValue('agt_2' as never)
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await ConfigSet.run(['agent'], process.cwd())
        expect(readUserConfig().agent).toBe('agt_2')
        expect(vi.mocked(select)).toHaveBeenCalledWith(
            expect.objectContaining({
                choices: [
                    expect.objectContaining({ value: 'agt_1' }),
                    expect.objectContaining({ value: 'agt_2' })
                ]
            })
        )
    })

    it('errors when the workspace has no agents', async () => {
        vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
        stubTTY()
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [],
                pagination: { cursor: null, hasMore: false, total: 0 }
            })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            ConfigSet.run(['agent'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('chatbase config set — clearing', () => {
    it('an empty value removes the key and says "cleared", not "set to "', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await ConfigSet.run(['agent', 'agt_1'], process.cwd())
        await ConfigSet.run(['agent', ''], process.cwd())
        expect(readUserConfig().agent).toBeUndefined()
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('agent cleared')
        expect(text).not.toContain('set to \n')
    })
})
