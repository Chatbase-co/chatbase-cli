import { describe, expect, it } from 'vitest'
import { computeRetryDelayMs, shouldRetry } from '../../src/client/retry.js'

describe('shouldRetry', () => {
    it('retries 429 for any method up to 3 attempts', () => {
        expect(shouldRetry(429, 'POST', 1)).toBe(true)
        expect(shouldRetry(429, 'GET', 3)).toBe(true)
        expect(shouldRetry(429, 'GET', 4)).toBe(false)
    })

    it('retries 5xx once, GET only', () => {
        expect(shouldRetry(502, 'GET', 1)).toBe(true)
        expect(shouldRetry(502, 'GET', 2)).toBe(false)
        expect(shouldRetry(502, 'POST', 1)).toBe(false)
    })

    it('never retries 4xx other than 429', () => {
        expect(shouldRetry(400, 'GET', 1)).toBe(false)
        expect(shouldRetry(404, 'GET', 1)).toBe(false)
    })
})

describe('computeRetryDelayMs', () => {
    it('uses X-RateLimit-Reset (unix ms) when present, capped at 60s', () => {
        const now = 1_700_000_000_000
        expect(computeRetryDelayMs(1, String(now + 5000), now)).toBe(5000)
        expect(computeRetryDelayMs(1, String(now + 500_000), now)).toBe(60_000)
        expect(computeRetryDelayMs(1, String(now - 1000), now)).toBeGreaterThan(
            0
        )
    })

    it('falls back to exponential backoff without the header', () => {
        const d1 = computeRetryDelayMs(1, null, 0)
        const d2 = computeRetryDelayMs(2, null, 0)
        expect(d1).toBeGreaterThanOrEqual(500)
        expect(d2).toBeGreaterThan(d1)
    })
})
