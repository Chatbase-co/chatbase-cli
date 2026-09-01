/**
 * CLI-side of the browser pairing login flow:
 *   1. POST /api/cli-pairing/create → get user_code + device_code
 *   2. User approves at verification_uri
 *   3. Poll POST /api/cli-pairing/exchange until approved
 *   4. Receive the minted API key + workspace info
 *
 * These endpoints are internal (not under /api/v2) and unauthenticated.
 */
import os from 'node:os'
import { parseErrorResponse, UsageError } from '../errors/errors.js'
import { rawApiFetch, resolveBaseUrl } from './client.js'
import { wasInterrupted } from './signals.js'

export type PairingResult = {
    apiKey: string
    workspace: { id: string; name: string }
}

type ExchangeAttempt =
    | { ok: true; status: number; body: unknown }
    | { ok: false; cause: unknown }

function pairingBaseUrl(baseUrl?: string): string {
    return new URL(resolveBaseUrl(baseUrl)).origin
}

export async function startPairing(opts?: { baseUrl?: string }): Promise<{
    deviceCode: string
    userCode: string
    verificationUri: string
    expiresIn: number
    interval: number
}> {
    const res = await rawApiFetch('POST', '/api/cli-pairing/create', {
        baseUrl: pairingBaseUrl(opts?.baseUrl),
        body: { device_name: os.hostname() }
    })
    if (res.status >= 400) {
        throw parseErrorResponse(res.status, res.body)
    }
    const d = res.body as {
        device_code: string
        user_code: string
        verification_uri: string
        expires_in: number
        interval: number
    }
    return {
        deviceCode: d.device_code,
        userCode: d.user_code,
        verificationUri: d.verification_uri,
        expiresIn: d.expires_in,
        interval: d.interval
    }
}

export async function pollExchange(
    deviceCode: string,
    opts: {
        intervalMs: number
        timeoutMs: number
        baseUrl?: string
        onPoll?: () => void
    }
): Promise<PairingResult> {
    const deadline = Date.now() + opts.timeoutMs
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const baseUrl = pairingBaseUrl(opts.baseUrl)

    for (;;) {
        opts.onPoll?.()

        const attempt: ExchangeAttempt = await rawApiFetch(
            'POST',
            '/api/cli-pairing/exchange',
            { baseUrl, body: { device_code: deviceCode } }
        ).then(
            (r): ExchangeAttempt => ({
                ok: true,
                status: r.status,
                body: r.body
            }),
            (cause: unknown): ExchangeAttempt => ({ ok: false, cause })
        )

        if (!attempt.ok) {
            const name = (attempt.cause as { name?: string } | null)?.name
            if (name === 'AbortError' && wasInterrupted()) throw attempt.cause
            if (Date.now() >= deadline) {
                throw new UsageError(
                    'Pairing request expired. Run `chatbase auth login` to try again.'
                )
            }
            await sleep(opts.intervalMs)
            continue
        }

        if (attempt.status < 400) {
            const result = attempt.body as {
                api_key: string
                workspace: { id: string; name: string }
            }
            return {
                apiKey: result.api_key,
                workspace: result.workspace
            }
        }

        const errorBody = attempt.body as {
            error?: { code?: string }
        }
        const code = errorBody?.error?.code

        if (code === 'PAIRING_PENDING' || code === 'PAIRING_SLOW_DOWN') {
            if (Date.now() >= deadline) {
                throw new UsageError(
                    'Pairing request expired. Run `chatbase auth login` to try again.'
                )
            }
            const delay =
                code === 'PAIRING_SLOW_DOWN'
                    ? opts.intervalMs * 2
                    : opts.intervalMs
            await sleep(delay)
            continue
        }

        throw parseErrorResponse(attempt.status, attempt.body)
    }
}
