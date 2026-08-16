const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR_LINE = '\r\x1b[2K'

/**
 * Transient stderr spinner for operations with dead air (file uploads,
 * non-streaming chat). Returns a stop() that erases the line. No-op when
 * stderr isn't a TTY — CI logs and pipes never see spinner frames.
 * `delayMs` holds the spinner back so sub-second operations never flicker.
 */
export function startSpinner(text: string, delayMs = 0): () => void {
    if (!process.stderr.isTTY) return () => {}
    let i = 0
    let timer: ReturnType<typeof setInterval> | undefined
    const delay = setTimeout(() => {
        process.stderr.write(HIDE_CURSOR)
        timer = setInterval(() => {
            process.stderr.write(`\r${FRAMES[i++ % FRAMES.length]} ${text}`)
        }, 80)
        timer.unref()
    }, delayMs)
    delay.unref()
    return () => {
        clearTimeout(delay)
        if (timer) {
            clearInterval(timer)
            process.stderr.write(CLEAR_LINE + SHOW_CURSOR)
        }
    }
}
