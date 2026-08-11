/**
 * Retry policy: 429 (rate limit) retries up to 3 times for ANY method —
 * a rate-limited request was never executed, so repeating it is safe.
 * 5xx retries once, GETs only: reads are safe to repeat, writes are not
 * (the server may have half-done the work before failing).
 */
export function shouldRetry(
    status: number,
    method: string,
    attempt: number
): boolean {
    if (status === 429) return attempt <= 3
    if (status >= 500 && method.toUpperCase() === 'GET') return attempt <= 1
    return false
}

// Epoch timestamps come in seconds (~1.7e9 today) or milliseconds (~1.7e12);
// the number's size reveals its unit. Anything under 1e11 can only be
// seconds (1e11 seconds = year 5138; 1e11 ms = 1973, long past). Our API
// sends seconds — this tolerates ms too in case that ever changes.
const SECONDS_MS_THRESHOLD = 1e11

/**
 * How long to sleep before a retry.
 *
 * Preferred: the X-RateLimit-Reset header says exactly when the rate window
 * reopens — wait precisely until then (capped at 60s so a bad header can't
 * stall the CLI; a past timestamp means the window is already open).
 *
 * Fallback (no usable header): exponential backoff — 500ms, 1s, 2s — plus
 * 0-250ms random jitter so many clients rate-limited together don't all
 * retry at the same instant and collide again.
 */
export function computeRetryDelayMs(
    attempt: number,
    resetHeader: string | null,
    nowMs: number
): number {
    if (resetHeader && /^\d+$/.test(resetHeader)) {
        const raw = Number(resetHeader)
        const resetMs = raw < SECONDS_MS_THRESHOLD ? raw * 1000 : raw
        const wait = resetMs - nowMs
        if (wait > 0) return Math.min(wait, 60_000)
    }
    const base = 500 * 2 ** (attempt - 1)
    return base + Math.floor(Math.random() * 250)
}
