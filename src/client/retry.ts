export function shouldRetry(
    status: number,
    method: string,
    attempt: number
): boolean {
    if (status === 429) return attempt <= 3
    if (status >= 500 && method.toUpperCase() === 'GET') return attempt <= 1
    return false
}

export function computeRetryDelayMs(
    attempt: number,
    resetHeader: string | null,
    nowMs: number
): number {
    if (resetHeader && /^\d+$/.test(resetHeader)) {
        const wait = Number(resetHeader) - nowMs
        if (wait > 0) return Math.min(wait, 60_000)
    }
    const base = 500 * 2 ** (attempt - 1)
    return base + Math.floor(Math.random() * 250)
}
