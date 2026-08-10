export function shouldRetry(
    status: number,
    method: string,
    attempt: number
): boolean {
    if (status === 429) return attempt <= 3
    if (status >= 500 && method.toUpperCase() === 'GET') return attempt <= 1
    return false
}

// Below this, a value is unambiguously epoch seconds: 1e11 seconds is year
// 5138, while 1e11 ms is 1973 — no real "reset at" timestamp is ms-sized and
// under 1e11. The API spec documents X-RateLimit-Reset as epoch seconds; this
// heuristic also tolerates a ms-based value if a future revision sends one.
const SECONDS_MS_THRESHOLD = 1e11

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
