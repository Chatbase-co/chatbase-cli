import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UsageError } from '../../src/errors/errors.js'
import { acquireSyncLock } from '../../src/sync/lock.js'

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sync-lock-'))
}

describe('acquireSyncLock', () => {
    it('blocks a second concurrent acquire for the same dir+agent', async () => {
        const dir = tmpDir()
        const release = await acquireSyncLock(dir, 'agt_lock_1')
        try {
            await expect(acquireSyncLock(dir, 'agt_lock_1')).rejects.toThrow(
                UsageError
            )
            await expect(acquireSyncLock(dir, 'agt_lock_1')).rejects.toThrow(
                /sync.*running/i
            )
        } finally {
            release()
        }
    })

    it('allows re-acquiring after release', async () => {
        const dir = tmpDir()
        const first = await acquireSyncLock(dir, 'agt_lock_2')
        first()
        const second = await acquireSyncLock(dir, 'agt_lock_2')
        second()
    })

    it('different agents (or dirs) do not contend', async () => {
        const dir = tmpDir()
        const a = await acquireSyncLock(dir, 'agt_lock_3a')
        const b = await acquireSyncLock(dir, 'agt_lock_3b')
        a()
        b()
    })

    it('reclaims a stale lock left by a crashed run', async () => {
        const dir = tmpDir()
        const first = await acquireSyncLock(dir, 'agt_lock_4')
        // Simulate a crash: the lock file exists but its owner never
        // released it. Age it past the staleness threshold.
        const lockFiles = fs
            .readdirSync(os.tmpdir())
            .filter((f) => f.startsWith('chatbase-sync-'))
        expect(lockFiles.length).toBeGreaterThan(0)
        const old = new Date(Date.now() - 10 * 60_000)
        for (const f of lockFiles) {
            fs.utimesSync(path.join(os.tmpdir(), f), old, old)
        }
        const second = await acquireSyncLock(dir, 'agt_lock_4')
        second()
        first() // releasing the original handle stays harmless
    })
})
