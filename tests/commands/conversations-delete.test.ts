import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversationsDelete from '../../src/commands/conversations/delete.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-conv-delete-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

const stderr = () => vi.spyOn(process.stderr, 'write').mockReturnValue(true)
const joined = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => String(c[0])).join('')

describe('chatbase conversations delete', () => {
    it('deletes one conversation when --confirm matches', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_1',
                method: 'DELETE'
            })
            .reply(200, { success: true })
        const err = stderr()
        await ConversationsDelete.run(
            ['conv_1', '--confirm', 'conv_1'],
            process.cwd()
        )
        expect(joined(err)).toContain('Deleted conversation conv_1')
    })

    it('deletes a user’s conversations with the user ID URL-encoded and reports skipped ones', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/users/jane%40example.com/conversations',
                method: 'DELETE'
            })
            .reply(200, { data: { deletedCount: 3, skippedCount: 1 } })
        const err = stderr()
        await ConversationsDelete.run(
            ['--user', 'jane@example.com', '--confirm', 'jane@example.com'],
            process.cwd()
        )
        const text = joined(err)
        expect(text).toContain(
            'Deleted 3 conversation(s) of user jane@example.com'
        )
        expect(text).toContain('1 skipped: HIPAA processing')
    })

    it('passes the raw response through with --json', async () => {
        const body = { data: { deletedCount: 2, skippedCount: 0 } }
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/users/usr_1/conversations',
                method: 'DELETE'
            })
            .reply(200, body)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await ConversationsDelete.run(
            ['--user', 'usr_1', '--confirm', 'usr_1', '--json'],
            process.cwd()
        )
        expect(JSON.parse(joined(out))).toEqual(body)
    })

    it('refuses without --confirm when not interactive, before calling the API', async () => {
        const err = stderr()
        await expect(
            ConversationsDelete.run(['conv_1', '--no-input'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(joined(err)).toContain('--confirm conv_1')
    })

    it('rejects a mismatched --confirm', async () => {
        stderr()
        await expect(
            ConversationsDelete.run(
                ['conv_1', '--confirm', 'conv_2'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('requires exactly one of CONVERSATION_ID and --user', async () => {
        stderr()
        await expect(
            ConversationsDelete.run(['--confirm', 'x'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        await expect(
            ConversationsDelete.run(
                ['conv_1', '--user', 'usr_1', '--confirm', 'usr_1'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('surfaces a 404 as an API error', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/conversations/conv_x',
                method: 'DELETE'
            })
            .reply(404, {
                error: {
                    code: 'RESOURCE_NOT_FOUND',
                    message: 'Conversation not found'
                }
            })
        const err = stderr()
        await expect(
            ConversationsDelete.run(
                ['conv_x', '--confirm', 'conv_x'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(joined(err)).toContain('Conversation not found')
    })
})
