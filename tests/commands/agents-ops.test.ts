import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentsAutoRetrain from '../../src/commands/agents/auto-retrain.js'
import AgentsStyles from '../../src/commands/agents/styles.js'
import AgentsTrain from '../../src/commands/agents/train.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

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
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-agents-ops-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase agents train', () => {
    it('agents train posts and reports', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/train', method: 'POST' })
            .reply(200, { success: true })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsTrain.run(['agt_1'], process.cwd())
        expect(err.mock.calls.join('')).toContain('Training started')
    })
})

describe('chatbase agents auto-retrain', () => {
    it('agents auto-retrain --enabled sends the boolean', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/auto-retrain',
                method: 'PUT'
            })
            .reply(200, (o) => {
                sent = bodyText(o.body)
                return { data: { autoRetrain: true } }
            })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsAutoRetrain.run(['agt_1', '--enabled'], process.cwd())
        expect(JSON.parse(sent)).toMatchObject({ enabled: true })
    })

    it('agents auto-retrain --disabled sends false', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/auto-retrain',
                method: 'PUT'
            })
            .reply(200, (o) => {
                sent = bodyText(o.body)
                return { success: true }
            })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsAutoRetrain.run(['agt_1', '--disabled'], process.cwd())
        expect(JSON.parse(sent)).toMatchObject({ enabled: false })
    })

    it('agents auto-retrain without flags rejects with oclif exit 2', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            AgentsAutoRetrain.run(['agt_1'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.join('')).not.toContain('issues/new')
    })

    it('agents auto-retrain with both flags rejects with oclif exit 2', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            AgentsAutoRetrain.run(
                ['agt_1', '--enabled', '--disabled'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.join('')).not.toContain('issues/new')
    })
})

describe('chatbase agents styles', () => {
    it('agents styles sends --data JSON', async () => {
        let sent = ''
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/styles', method: 'PUT' })
            .reply(200, (o) => {
                sent = bodyText(o.body)
                return { success: true }
            })
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await AgentsStyles.run(
            ['agt_1', '--data', '{"chat":{"theme":"dark"}}'],
            process.cwd()
        )
        expect(JSON.parse(sent)).toMatchObject({
            styles: { chat: { theme: 'dark' } }
        })
    })
})
