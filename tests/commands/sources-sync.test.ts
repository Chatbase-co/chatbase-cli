import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { confirm, input } from '@inquirer/prompts'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@inquirer/prompts', () => ({
    confirm: vi.fn(),
    input: vi.fn()
}))
vi.mock('../../src/client/files.js', () => ({
    uploadFileSource: vi.fn()
}))
// scanDir defaults to the REAL implementation (wrapped in vi.fn so it can be
// overridden per-test) — every test except the case-collision one relies on
// real filesystem scanning. Case-insensitive collisions can't be
// represented as two on-disk files on a case-insensitive filesystem (e.g.
// macOS/APFS: writing 'readme.md' after 'Readme.md' overwrites the SAME
// file), so that one test overrides scanDir's return value directly instead
// — same approach tests/sync/diff.test.ts uses for computeSyncPlan.
vi.mock('../../src/sync/diff.js', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../src/sync/diff.js')>()
    return { ...actual, scanDir: vi.fn(actual.scanDir) }
})

import { uploadFileSource } from '../../src/client/files.js'
import SourcesSync from '../../src/commands/sources/sync.js'
import { scanDir } from '../../src/sync/diff.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

/** Writes each `files[relPath] = content` under a fresh mkdtemp dir. */
function mkDir(files: Record<string, string> = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sync-cmd-'))
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, content)
    }
    return dir
}

function sourcesPage(data: Array<Record<string, unknown>>) {
    return { data, pagination: { cursor: null, hasMore: false } }
}

function stubTTY() {
    const stdin = new Readable({
        read() {}
    }) as unknown as NodeJS.ReadStream & { fd: 0 }
    Object.defineProperty(stdin, 'isTTY', { value: true })
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sync-cmd-cfg-'))
    )
    vi.mocked(uploadFileSource).mockReset()
    vi.mocked(confirm).mockReset()
    vi.mocked(input).mockReset()
    vi.mocked(scanDir).mockClear()
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('chatbase sources sync — dry run', () => {
    it('prints the plan and makes no upload/delete calls', async () => {
        const dir = mkDir({ 'new.md': 'hello world' })
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, sourcesPage([]))
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesSync.run([dir, '--dry-run'], process.cwd())
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('+1 created')
        expect(text).toContain('new.md')
        expect(uploadFileSource).not.toHaveBeenCalled()
    })
})

describe('chatbase sources sync — --force', () => {
    it('applies the plan: uploads creates/updates and deletes removals', async () => {
        const dir = mkDir({
            'new.md': 'brand new',
            'changed.md': 'now this is much longer content'
        })
        vi.mocked(uploadFileSource).mockResolvedValue({ id: 'src_new' })
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(
                200,
                sourcesPage([
                    {
                        id: 'src_changed',
                        type: 'file',
                        name: 'changed.md',
                        size: 1,
                        status: 'trained'
                    },
                    {
                        id: 'src_gone',
                        type: 'file',
                        name: 'gone.md',
                        size: 5,
                        status: 'trained'
                    }
                ])
            )
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_gone',
                method: 'DELETE'
            })
            .reply(200, {})
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesSync.run([dir, '--force'], process.cwd())

        expect(uploadFileSource).toHaveBeenCalledTimes(2)
        expect(uploadFileSource).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'new.md', sourceId: undefined })
        )
        expect(uploadFileSource).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'changed.md',
                sourceId: 'src_changed'
            })
        )
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('Synced: +1 ~1 −1 (0 unchanged)')
    })
})

describe('chatbase sources sync — non-interactive refusal', () => {
    it('refuses to apply without --force when not a TTY (exit 2)', async () => {
        const dir = mkDir({ 'new.md': 'hello' })
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, sourcesPage([]))
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesSync.run([dir], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.join('')).toContain('--force')
        expect(uploadFileSource).not.toHaveBeenCalled()
    })

    it('names the typed-confirmation requirement when >50% of file sources would be deleted', async () => {
        const dir = mkDir({}) // nothing local matches any remote file
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(
                200,
                sourcesPage([
                    {
                        id: 'src_1',
                        type: 'file',
                        name: 'a.md',
                        size: 1,
                        status: 'trained'
                    },
                    {
                        id: 'src_2',
                        type: 'file',
                        name: 'b.md',
                        size: 1,
                        status: 'trained'
                    },
                    {
                        id: 'src_3',
                        type: 'file',
                        name: 'c.md',
                        size: 1,
                        status: 'trained'
                    }
                ])
            )
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesSync.run([dir], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.join('')).toMatch(/typ(e|ing).*agent id/i)
        expect(uploadFileSource).not.toHaveBeenCalled()
    })
})

describe('chatbase sources sync — failure path', () => {
    it('exits 1 and reprints the failing file when an upload fails', async () => {
        const dir = mkDir({ 'good.md': 'ok', 'bad.md': 'not ok' })
        vi.mocked(uploadFileSource).mockImplementation(async (opts) => {
            if (opts.name === 'bad.md') throw new Error('upload failed: 500')
            return { id: 'src_ok' }
        })
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, sourcesPage([]))
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesSync.run([dir, '--force'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('bad.md')
        expect(text).toContain('upload failed: 500')
    })
})

describe('chatbase sources sync — sync.dir from chatbase.json', () => {
    it('is used when no positional dir is given, resolved relative to the file itself (not cwd)', async () => {
        // oclif's own Config.load() needs a real path with a package.json
        // above it (unrelated to our project-config lookup) — capture it
        // BEFORE stubbing process.cwd() below, which is what our own
        // findProjectConfig() call (inside the command) actually reads.
        const realCwd = process.cwd()
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sync-project-'))
        fs.mkdirSync(path.join(root, 'kb'))
        fs.writeFileSync(path.join(root, 'kb', 'guide.md'), 'hello there')
        fs.writeFileSync(
            path.join(root, 'chatbase.json'),
            JSON.stringify({ agent: 'agt_proj', sync: { dir: 'kb' } })
        )
        const nestedCwd = path.join(root, 'sub', 'deeper')
        fs.mkdirSync(nestedCwd, { recursive: true })
        vi.spyOn(process, 'cwd').mockReturnValue(nestedCwd)
        vi.stubEnv('CHATBASE_AGENT_ID', '')
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_proj/sources',
                method: 'GET'
            })
            .reply(200, sourcesPage([]))
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesSync.run(['--dry-run'], realCwd)
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('guide.md')
    })
})

describe('chatbase sources sync — interactive confirmation', () => {
    it('applies after the user confirms y on a TTY', async () => {
        stubTTY()
        const dir = mkDir({ 'new.md': 'hello' })
        vi.mocked(uploadFileSource).mockResolvedValue({ id: 'src_new' })
        vi.mocked(confirm).mockResolvedValue(true as never)
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, sourcesPage([]))
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesSync.run([dir], process.cwd())
        expect(uploadFileSource).toHaveBeenCalledTimes(1)
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('agt_1')
            })
        )
    })

    it('aborts without applying when the user declines on a TTY', async () => {
        stubTTY()
        const dir = mkDir({ 'new.md': 'hello' })
        vi.mocked(confirm).mockResolvedValue(false as never)
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, sourcesPage([]))
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesSync.run([dir], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(uploadFileSource).not.toHaveBeenCalled()
    })

    it('escalates a high-risk delete plan to a typed agent-ID confirmation, and proceeds on a match', async () => {
        stubTTY()
        const dir = mkDir({})
        vi.mocked(input).mockResolvedValue('agt_1' as never)
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(
                200,
                sourcesPage([
                    {
                        id: 'src_1',
                        type: 'file',
                        name: 'a.md',
                        size: 1,
                        status: 'trained'
                    },
                    {
                        id: 'src_2',
                        type: 'file',
                        name: 'b.md',
                        size: 1,
                        status: 'trained'
                    }
                ])
            )
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_1',
                method: 'DELETE'
            })
            .reply(200, {})
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_2',
                method: 'DELETE'
            })
            .reply(200, {})
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesSync.run([dir], process.cwd())
        expect(input).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('agt_1')
            })
        )
        expect(confirm).not.toHaveBeenCalled()
    })

    it('aborts a high-risk delete plan when the typed agent ID does not match', async () => {
        stubTTY()
        const dir = mkDir({})
        vi.mocked(input).mockResolvedValue('wrong-id' as never)
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(
                200,
                sourcesPage([
                    {
                        id: 'src_1',
                        type: 'file',
                        name: 'a.md',
                        size: 1,
                        status: 'trained'
                    },
                    {
                        id: 'src_2',
                        type: 'file',
                        name: 'b.md',
                        size: 1,
                        status: 'trained'
                    }
                ])
            )
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            SourcesSync.run([dir], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('chatbase sources sync — case collisions', () => {
    it('prints a yellow warning listing case-insensitive filename collisions', async () => {
        // Two on-disk files differing only by case can't be represented
        // here: macOS/APFS is case-insensitive-but-preserving, so writing
        // 'readme.md' after 'Readme.md' overwrites the same file rather
        // than creating a second one. Override scanDir's result directly
        // instead, same workaround tests/sync/diff.test.ts's unit tests use
        // by calling computeSyncPlan with synthetic LocalFiles.
        const dir = mkDir({})
        vi.mocked(scanDir).mockReturnValueOnce([
            {
                relPath: 'Readme.md',
                size: 1,
                absPath: path.join(dir, 'Readme.md')
            },
            {
                relPath: 'readme.md',
                size: 2,
                absPath: path.join(dir, 'readme.md')
            }
        ])
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(200, sourcesPage([]))
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesSync.run([dir, '--dry-run'], process.cwd())
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('readme.md')
        expect(text.toLowerCase()).toContain('collision')
    })
})

describe('chatbase sources sync — no-op plan', () => {
    it('does not prompt when the plan has no changes, even without --force on a non-TTY', async () => {
        const content = 'stable content'
        const dir = mkDir({ 'same.md': content })
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents/agt_1/sources', method: 'GET' })
            .reply(
                200,
                sourcesPage([
                    {
                        id: 'src_same',
                        type: 'file',
                        name: 'same.md',
                        size: content.length,
                        status: 'trained'
                    }
                ])
            )
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await SourcesSync.run([dir], process.cwd())
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('Synced: +0 ~0 −0 (1 unchanged)')
    })
})
