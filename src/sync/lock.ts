import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { UsageError } from '../errors/errors.js'

const STALE_MS = 5 * 60_000

function lockPath(dir: string, agentId: string): string {
    const key = crypto
        .createHash('sha1')
        .update(`${path.resolve(dir)}::${agentId}`)
        .digest('hex')
    return path.join(os.tmpdir(), `chatbase-sync-${key}.lock`)
}

/**
 * Exclusive-create lock so two concurrent `sources sync` runs against the
 * same directory/agent don't both fetch the same "file missing remotely"
 * snapshot and both upload it — the API has no duplicate-name guard, so the
 * twin would become an orphaned source nothing ever cleans up. Same-machine
 * protection only (the lock lives in this machine's tmpdir); overlapping
 * runs on different hosts need a server-side uniqueness guarantee. A lock
 * older than STALE_MS is assumed to be from a crashed run and reclaimed.
 */
export async function acquireSyncLock(
    dir: string,
    agentId: string
): Promise<() => void> {
    const file = lockPath(dir, agentId)
    try {
        fs.writeFileSync(file, String(process.pid), { flag: 'wx' })
    } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code !== 'EEXIST') throw err
        const age = Date.now() - fs.statSync(file).mtimeMs
        if (age < STALE_MS) {
            throw new UsageError(
                `Another \`sources sync\` appears to be running against this directory/agent (lock: ${file}). Wait for it to finish, or remove the lock file if it crashed.`
            )
        }
        fs.writeFileSync(file, String(process.pid))
    }
    return () => {
        try {
            fs.unlinkSync(file)
        } catch {
            /* already gone — fine */
        }
    }
}
