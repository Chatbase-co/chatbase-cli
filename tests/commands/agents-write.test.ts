import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentsClone from '../../src/commands/agents/clone.js'
import AgentsCreate from '../../src/commands/agents/create.js'
import AgentsDelete from '../../src/commands/agents/delete.js'
import AgentsUpdate from '../../src/commands/agents/update.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

// The mock reply callback's `opts.body` may arrive as a string, Buffer, or
// Uint8Array depending on how the request body was read off the wire.
function bodyText(body: unknown): string {
    if (body == null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
    return String(body)
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-agents-write-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase agents create', () => {
    it('posts name/instructions and prints the id on stdout', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'POST' })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                // POST /agents returns AgentCreatedResponse directly, not wrapped in { data: ... }
                return { id: 'agt_new' }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsCreate.run(
            ['--name', 'Bot', '--instructions', 'Be helpful', '--quiet'],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toMatchObject({
            name: 'Bot',
            instructions: 'Be helpful'
        })
        expect(out.mock.calls.join('')).toBe('agt_new\n')
    })

    it('dedicated flags override keys from --data', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'POST' })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return { id: 'agt_new' }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsCreate.run(
            [
                '--data',
                '{"name":"From Data","model":"gpt-4o-mini"}',
                '--name',
                'From Flag',
                '--quiet'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toMatchObject({
            name: 'From Flag',
            model: 'gpt-4o-mini'
        })
    })
})

describe('chatbase agents update', () => {
    it('PUTs name/instructions and prints a success note', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1', method: 'PUT' })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return { success: true }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsUpdate.run(['agt_1', '--name', 'Renamed'], process.cwd())
        expect(JSON.parse(sentBody)).toMatchObject({ name: 'Renamed' })
        expect(err.mock.calls.join('')).toContain('Updated agent agt_1')
    })
})

describe('chatbase agents delete', () => {
    it('refuses without --confirm when not a TTY', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            AgentsDelete.run(['agt_1'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('works with --confirm matching the id', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1', method: 'DELETE' })
            .reply(200, { success: true })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsDelete.run(['agt_1', '--confirm', 'agt_1'], process.cwd())
        expect(err.mock.calls.join('')).toContain('Deleted agent agt_1')
    })

    it('rejects a mismatched --confirm', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            AgentsDelete.run(['agt_1', '--confirm', 'agt_2'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('chatbase agents clone', () => {
    it('posts to /clone and prints the new id', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/clone', method: 'POST' })
            // POST /agents/{agentId}/clone returns AgentCreatedResponse directly, not wrapped in { data: ... }
            .reply(201, { id: 'agt_copy' })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsClone.run(['agt_1', '--quiet'], process.cwd())
        expect(out.mock.calls.join('')).toBe('agt_copy\n')
    })
})
