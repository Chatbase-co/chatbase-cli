import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/client/files.js', () => ({
    uploadFileSource: vi.fn()
}))

import { createApiClient } from '../../src/client/client.js'
import { uploadFileSource } from '../../src/client/files.js'
import type { SyncPlan } from '../../src/sync/diff.js'
import { executeSyncPlan } from '../../src/sync/execute.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    // `restoreMocks` (vitest.config.ts) only restores vi.spyOn targets, not
    // this vi.mock module factory's vi.fn() — clear its call history and
    // implementation explicitly so each test starts from a clean slate.
    vi.mocked(uploadFileSource).mockReset()
})

afterEach(async () => {
    await mock.close()
})

function mkPlan(overrides: Partial<SyncPlan> = {}): SyncPlan {
    return {
        create: [],
        update: [],
        del: [],
        unchanged: 0,
        caseCollisions: [],
        ...overrides
    }
}

describe('executeSyncPlan', () => {
    it('failure lines carry the ApiError code and request id for log correlation', async () => {
        const { ApiError } = await import('../../src/errors/errors.js')
        vi.mocked(uploadFileSource).mockRejectedValue(
            new ApiError({
                code: 'ENDPOINT_TEMPORARILY_DISABLED',
                message: 'This endpoint is temporarily disabled',
                status: 503,
                requestId: 'fra1::req-42'
            })
        )
        const plan = mkPlan({
            create: [{ relPath: 'a.md', size: 1, absPath: '/x/a.md' }]
        })
        const progress: string[] = []
        const client = createApiClient({ apiKey: 'sk-test' })

        const result = await executeSyncPlan(plan, {
            agentId: 'agt_1',
            apiKey: 'sk-test',
            client,
            onProgress: (line) => progress.push(line)
        })

        expect(result.failures[0]?.error).toContain(
            '(ENDPOINT_TEMPORARILY_DISABLED)'
        )
        expect(result.failures[0]?.error).toContain('request id: fra1::req-42')
    })

    it('uploads every create/update and deletes every removed source', async () => {
        vi.mocked(uploadFileSource).mockResolvedValue({ id: 'src_new' })
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_del',
                method: 'DELETE'
            })
            .reply(200, {})

        const plan = mkPlan({
            create: [{ relPath: 'a.md', size: 1, absPath: '/x/a.md' }],
            update: [
                {
                    relPath: 'b.md',
                    size: 2,
                    absPath: '/x/b.md',
                    sourceId: 'src_b'
                }
            ],
            del: [{ sourceId: 'src_del', name: 'c.md' }]
        })
        const progress: string[] = []
        const client = createApiClient({ apiKey: 'sk-test' })

        const result = await executeSyncPlan(plan, {
            agentId: 'agt_1',
            apiKey: 'sk-test',
            client,
            onProgress: (line) => progress.push(line)
        })

        expect(uploadFileSource).toHaveBeenCalledTimes(2)
        expect(uploadFileSource).toHaveBeenCalledWith(
            expect.objectContaining({
                agentId: 'agt_1',
                filePath: '/x/a.md',
                name: 'a.md',
                apiKey: 'sk-test',
                sourceId: undefined
            })
        )
        expect(uploadFileSource).toHaveBeenCalledWith(
            expect.objectContaining({
                agentId: 'agt_1',
                filePath: '/x/b.md',
                name: 'b.md',
                apiKey: 'sk-test',
                sourceId: 'src_b'
            })
        )
        expect(result.applied).toBe(3)
        expect(result.failures).toEqual([])
        expect(progress).toHaveLength(3)
    })

    it('collects a failing upload without throwing, while other uploads still complete', async () => {
        vi.mocked(uploadFileSource).mockImplementation(async (opts) => {
            if (opts.filePath === '/x/bad.md')
                throw new Error('upload failed: 500')
            return { id: 'src_ok' }
        })

        const plan = mkPlan({
            create: [
                { relPath: 'good.md', size: 1, absPath: '/x/good.md' },
                { relPath: 'bad.md', size: 1, absPath: '/x/bad.md' }
            ]
        })
        const client = createApiClient({ apiKey: 'sk-test' })

        const result = await executeSyncPlan(plan, {
            agentId: 'agt_1',
            apiKey: 'sk-test',
            client,
            onProgress: () => {}
        })

        expect(uploadFileSource).toHaveBeenCalledTimes(2)
        expect(result.failures).toEqual([
            { name: 'bad.md', error: expect.stringContaining('upload failed') }
        ])
        expect(result.applied).toBe(1)
    })

    it('never runs more uploads concurrently than the requested limit', async () => {
        let active = 0
        let maxActive = 0
        vi.mocked(uploadFileSource).mockImplementation(async () => {
            active++
            maxActive = Math.max(maxActive, active)
            await new Promise((r) => setTimeout(r, 10))
            active--
            return { id: 'src_x' }
        })

        const plan = mkPlan({
            create: Array.from({ length: 10 }, (_, i) => ({
                relPath: `f${i}.md`,
                size: 1,
                absPath: `/x/f${i}.md`
            }))
        })
        const client = createApiClient({ apiKey: 'sk-test' })

        const result = await executeSyncPlan(plan, {
            agentId: 'agt_1',
            apiKey: 'sk-test',
            client,
            concurrency: 4,
            onProgress: () => {}
        })

        expect(maxActive).toBeLessThanOrEqual(4)
        expect(maxActive).toBeGreaterThan(1)
        expect(result.applied).toBe(10)
    })

    it('defaults concurrency to 4 when not specified', async () => {
        let active = 0
        let maxActive = 0
        vi.mocked(uploadFileSource).mockImplementation(async () => {
            active++
            maxActive = Math.max(maxActive, active)
            await new Promise((r) => setTimeout(r, 10))
            active--
            return { id: 'src_x' }
        })

        const plan = mkPlan({
            create: Array.from({ length: 8 }, (_, i) => ({
                relPath: `f${i}.md`,
                size: 1,
                absPath: `/x/f${i}.md`
            }))
        })
        const client = createApiClient({ apiKey: 'sk-test' })

        await executeSyncPlan(plan, {
            agentId: 'agt_1',
            apiKey: 'sk-test',
            client,
            onProgress: () => {}
        })

        expect(maxActive).toBeLessThanOrEqual(4)
        expect(maxActive).toBeGreaterThan(1)
    })

    it('collects a failing delete without throwing', async () => {
        vi.mocked(uploadFileSource).mockResolvedValue({ id: 'src_ok' })
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_bad',
                method: 'DELETE'
            })
            .reply(404, {
                error: { code: 'NOT_FOUND', message: 'source not found' }
            })

        const plan = mkPlan({ del: [{ sourceId: 'src_bad', name: 'gone.md' }] })
        const client = createApiClient({ apiKey: 'sk-test' })

        const result = await executeSyncPlan(plan, {
            agentId: 'agt_1',
            apiKey: 'sk-test',
            client,
            onProgress: () => {}
        })

        expect(result.failures).toEqual([
            {
                name: 'gone.md',
                error: expect.stringContaining('source not found')
            }
        ])
        expect(result.applied).toBe(0)
    })

    it('calls onProgress once per completed operation with a status line naming the file', async () => {
        vi.mocked(uploadFileSource).mockResolvedValue({ id: 'src_ok' })
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/sources/src_del',
                method: 'DELETE'
            })
            .reply(200, {})

        const plan = mkPlan({
            create: [{ relPath: 'new.md', size: 1, absPath: '/x/new.md' }],
            del: [{ sourceId: 'src_del', name: 'old.md' }]
        })
        const progress: string[] = []
        const client = createApiClient({ apiKey: 'sk-test' })

        await executeSyncPlan(plan, {
            agentId: 'agt_1',
            apiKey: 'sk-test',
            client,
            onProgress: (line) => progress.push(line)
        })

        expect(progress).toHaveLength(2)
        expect(progress.some((l) => l.includes('new.md'))).toBe(true)
        expect(progress.some((l) => l.includes('old.md'))).toBe(true)
    })

    it('resolves the promise even when every operation fails, never throwing', async () => {
        vi.mocked(uploadFileSource).mockRejectedValue(new Error('boom'))

        const plan = mkPlan({
            create: [{ relPath: 'a.md', size: 1, absPath: '/x/a.md' }]
        })
        const client = createApiClient({ apiKey: 'sk-test' })

        const result = await executeSyncPlan(plan, {
            agentId: 'agt_1',
            apiKey: 'sk-test',
            client,
            onProgress: () => {}
        })

        expect(result.applied).toBe(0)
        expect(result.failures).toEqual([
            { name: 'a.md', error: expect.stringContaining('boom') }
        ])
    })
})
