import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SourcesDelete from '../../src/commands/sources/delete.js'
import SourcesRestore from '../../src/commands/sources/restore.js'
import SourcesUpdate from '../../src/commands/sources/update.js'

const BASE = 'https://www.chatbase.co'
const FILES_BASE = 'https://files.chatbase.co'
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
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sources-write-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase sources update', () => {
    it('PUTs JSON body for text source via --data', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_1',
                method: 'PUT'
            })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return {
                    id: 'src_1',
                    name: 'Updated',
                    type: 'text',
                    status: 'trained',
                    size: 0
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesUpdate.run(
            ['src_1', '--data', '{"type":"text","content":"new"}'],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toMatchObject({
            type: 'text',
            content: 'new'
        })
        expect(err.mock.calls.join('')).toContain('Updated source src_1')
    })

    it('PUTs multipart file via uploadFileSource', async () => {
        const tmpFile = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-file-'))
        const filePath = path.join(tmpFile, 'test.pdf')
        fs.writeFileSync(filePath, 'pdf content')

        mock.get(FILES_BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_1',
                method: 'PUT'
            })
            .reply(200, () => {
                return { data: { id: 'src_1' } }
            })

        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesUpdate.run(['src_1', '--file', filePath], process.cwd())
        expect(err.mock.calls.join('')).toContain('Updated source src_1')
        fs.rmSync(tmpFile, { recursive: true })
    })

    it('rejects --data and --file together', async () => {
        const tmpFile = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-file-'))
        const filePath = path.join(tmpFile, 'test.pdf')
        fs.writeFileSync(filePath, 'pdf content')

        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesUpdate.run(
                [
                    'src_1',
                    '--data',
                    '{"type":"text"}',
                    '--file',
                    filePath,
                    '-a',
                    'agt_1'
                ],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        fs.rmSync(tmpFile, { recursive: true })
    })

    it('rejects neither --data nor --file', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesUpdate.run(['src_1', '-a', 'agt_1'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('chatbase sources delete', () => {
    it('DELETEs source without confirmation and prints restore hint on stderr', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_1',
                method: 'DELETE'
            })
            .reply(200, () => {
                return {
                    id: 'src_1',
                    name: 'Source',
                    type: 'text',
                    status: 'deleted',
                    size: 0
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesDelete.run(['src_1'], process.cwd())
        const stderr = err.mock.calls.join('')
        expect(stderr).toContain('Deleted source src_1')
        expect(stderr).toContain(
            '↩ restore with: chatbase sources restore src_1 -a agt_1'
        )
    })
})

describe('chatbase sources restore', () => {
    it('POSTs to restore endpoint and prints success message', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_1/restore',
                method: 'POST'
            })
            .reply(200, () => {
                return {
                    id: 'src_1',
                    name: 'Source',
                    type: 'text',
                    status: 'trained',
                    size: 0
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesRestore.run(['src_1'], process.cwd())
        expect(err.mock.calls.join('')).toContain('Restored source src_1')
    })
})
