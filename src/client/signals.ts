/**
 * The Ctrl-C contract. Registering a SIGINT listener replaces Node's
 * die-instantly default, so this file owns the guarantee that Ctrl-C
 * always works:
 *
 *   1st Ctrl-C  → say "Interrupted", abort the shared signal (every
 *                 in-flight request is wired to it via AbortSignal.any),
 *                 let the code unwind → catch() exits 130 silently.
 *   2nd Ctrl-C  → exit immediately, skipping even fast teardown.
 *
 * 130 = 128 + SIGINT's signal number (2) — the Unix convention shells and
 * CI check for "user cancelled", as distinct from "failed".
 */
const controller = new AbortController()
let interrupts = 0
let installed = false

export function getSigintSignal(): AbortSignal {
    return controller.signal
}

/** True once SIGINT has been received at least once (see installSigintHandler). */
export function wasInterrupted(): boolean {
    return interrupts > 0
}

/** Idempotent — every command's init() calls this; only one listener ever. */
export function installSigintHandler(): void {
    if (installed) return
    installed = true
    process.on('SIGINT', () => {
        interrupts += 1
        if (interrupts === 1) {
            process.stderr.write('\nInterrupted\n')
            controller.abort()
            // Insurance: if graceful teardown hangs, force-exit in 2s.
            // unref() is load-bearing — without it this timer would keep
            // the process alive 2s on EVERY Ctrl-C, even after clean exit.
            setTimeout(() => process.exit(130), 2000).unref()
        } else {
            process.exit(130)
        }
    })
}
