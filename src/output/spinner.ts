const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR_LINE = '\r\x1b[2K'

/**
 * Transient stderr spinner for operations with dead air (file uploads).
 * Returns a stop() that erases the line. No-op when stderr isn't a TTY —
 * CI logs and pipes never see spinner frames.
 */
export function startSpinner(text: string): () => void {
    if (!process.stderr.isTTY) return () => {}
    let i = 0
    process.stderr.write(HIDE_CURSOR)
    const timer = setInterval(() => {
        process.stderr.write(`\r${FRAMES[i++ % FRAMES.length]} ${text}`)
    }, 80)
    timer.unref()
    return () => {
        clearInterval(timer)
        process.stderr.write(CLEAR_LINE + SHOW_CURSOR)
    }
}
