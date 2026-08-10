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

export function installSigintHandler(): void {
    if (installed) return
    installed = true
    process.on('SIGINT', () => {
        interrupts += 1
        if (interrupts === 1) {
            process.stderr.write('\nInterrupted\n')
            controller.abort()
            // Hard cap: if graceful teardown hangs, force-exit in 2s.
            setTimeout(() => process.exit(130), 2000).unref()
        } else {
            process.exit(130)
        }
    })
}
