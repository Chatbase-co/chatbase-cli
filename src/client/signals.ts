const controller = new AbortController()
let interrupts = 0
let installed = false

export function getSigintSignal(): AbortSignal {
    return controller.signal
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
