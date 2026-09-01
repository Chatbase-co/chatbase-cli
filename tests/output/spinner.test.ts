import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { maybeSpinner } from '../../src/output/spinner.js'

/** Forces stderr to look like a TTY so the spinner would normally run;
 * restore() puts the original descriptor back. */
function stubStderrTTY(): { restore: () => void } {
    const original = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
    Object.defineProperty(process.stderr, 'isTTY', {
        value: true,
        configurable: true
    })
    return {
        restore: () => {
            if (original) {
                Object.defineProperty(process.stderr, 'isTTY', original)
            } else {
                delete (process.stderr as { isTTY?: boolean }).isTTY
            }
        }
    }
}

describe('maybeSpinner', () => {
    let tty: { restore: () => void }

    beforeEach(() => {
        vi.useFakeTimers()
        tty = stubStderrTTY()
    })

    afterEach(() => {
        tty.restore()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('returns a no-op that writes nothing when suppressed', () => {
        const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const stop = maybeSpinner(true, 'Working…')
        vi.advanceTimersByTime(1000)
        stop()
        expect(write).not.toHaveBeenCalled()
    })

    it('starts a real spinner when not suppressed', () => {
        const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const stop = maybeSpinner(false, 'Working…')
        vi.advanceTimersByTime(1000)
        expect(write).toHaveBeenCalled()
        stop()
    })

    it('treats an undefined suppress flag as not suppressed', () => {
        const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        const stop = maybeSpinner(undefined, 'Working…')
        vi.advanceTimersByTime(1000)
        expect(write).toHaveBeenCalled()
        stop()
    })
})
