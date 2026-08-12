import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Docs from '../../src/commands/docs.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const originalIsTTY = process.stdout.isTTY

function setStdoutTTY(value: boolean | undefined) {
    Object.defineProperty(process.stdout, 'isTTY', {
        value,
        configurable: true
    })
}

function fakeChild(): EventEmitter & { unref: () => void } {
    const emitter = new EventEmitter() as EventEmitter & {
        unref: () => void
    }
    emitter.unref = vi.fn()
    return emitter
}

// run() does async work (this.parse()) before it calls spawn(), so a single
// microtask tick isn't reliably enough to know the 'error'/'spawn' listeners
// are attached yet. Poll until spawn() has actually been invoked — at that
// point the listeners are registered too, since trySpawn() calls spawn() and
// then .once(...) synchronously within the same Promise executor.
async function waitForSpawnCall(): Promise<void> {
    for (let i = 0; i < 200 && vi.mocked(spawn).mock.calls.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 0))
    }
}

beforeEach(() => {
    // vi.mock's factory-created vi.fn() keeps call history across tests —
    // restoreAllMocks() alone won't clear it, and waitForSpawnCall() relies
    // on an empty call list to know THIS test's spawn() hasn't fired yet.
    vi.mocked(spawn).mockClear()
})

afterEach(() => {
    vi.restoreAllMocks()
    setStdoutTTY(originalIsTTY)
})

describe('chatbase docs', () => {
    it('prints the URL when not a TTY', async () => {
        setStdoutTTY(false)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Docs.run(['sources', 'sync'], process.cwd())
        expect(err.mock.calls.join('')).toContain(
            'https://www.chatbase.co/docs/cli'
        )
    })

    it('builds a per-command anchor by joining words with "-"', async () => {
        setStdoutTTY(false)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Docs.run(['sources', 'sync'], process.cwd())
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'https://www.chatbase.co/docs/cli/sources-sync'
        )
    })

    it('prints the bare base URL when given no command', async () => {
        setStdoutTTY(false)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Docs.run([], process.cwd())
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'https://www.chatbase.co/docs/cli\n'
        )
    })

    it('prints the URL when --no-input is set, even on a TTY', async () => {
        setStdoutTTY(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Docs.run(['--no-input'], process.cwd())
        expect(err.mock.calls.join('')).toContain(
            'https://www.chatbase.co/docs/cli'
        )
        expect(spawn).not.toHaveBeenCalled()
    })

    it('spawns the platform opener on a TTY and narrates instead of printing the raw URL', async () => {
        setStdoutTTY(true)
        const child = fakeChild()
        vi.mocked(spawn).mockReturnValue(child as never)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const runPromise = Docs.run([], process.cwd())
        await waitForSpawnCall()
        child.emit('spawn')
        await runPromise
        const expectedOpener =
            process.platform === 'darwin' ? 'open' : 'xdg-open'
        expect(spawn).toHaveBeenCalledWith(
            expectedOpener,
            ['https://www.chatbase.co/docs/cli'],
            expect.objectContaining({ detached: true })
        )
        const text = err.mock.calls.map((c) => String(c[0])).join('')
        expect(text).toContain('Opening https://www.chatbase.co/docs/cli')
    })

    it('falls back to printing the URL when spawning fails', async () => {
        setStdoutTTY(true)
        const child = fakeChild()
        vi.mocked(spawn).mockReturnValue(child as never)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const runPromise = Docs.run([], process.cwd())
        await waitForSpawnCall()
        child.emit('error', new Error('ENOENT'))
        await runPromise
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toBe(
            'https://www.chatbase.co/docs/cli\n'
        )
    })
})
