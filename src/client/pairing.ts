/**
 * CLI-side of the browser pairing login flow:
 *   1. POST /cli/pairing → get user_code + device_code
 *   2. User approves at verification_uri
 *   3. Poll POST /cli/pairing/exchange until approved
 *   4. Receive the minted API key + workspace info
 *
 * These endpoints are unauthenticated — the user doesn't have a key yet.
 */
import os from 'node:os'
import type { components } from '../generated/api.js'
import { createApiClient, throwIfError } from './client.js'
import { wasInterrupted } from './signals.js'

export type PairingResult = {
    apiKey: string
    workspace: { id: string; name: string }
}

/** One poll of the exchange endpoint: either the call's typed result, or
 * the network-level failure — captured as a value so the poll loop can
 * treat ONLY transport errors as transient, never response-handling ones. */
type ExchangeAttempt =
    | { ok: true; data: unknown; error: unknown; response: Response }
    | { ok: false; cause: unknown }

export async function startPairing(opts?: { baseUrl?: string }): Promise<{
    deviceCode: string
    userCode: string
    verificationUri: string
    expiresIn: number
    interval: number
}> {
    const client = createApiClient({ baseUrl: opts?.baseUrl })
    const { data, error, response } = await client.POST('/cli/pairing', {
        body: { device_name: os.hostname() }
    })
    throwIfError(response, error)
    // The generated schema type keeps this cast honest: a field rename in
    // the API contract becomes a compile error here instead of a runtime
    // surprise (this exact type drifted twice as a hand-written literal).
    const d = data as components['schemas']['CliPairingCreateResponse']
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
    const client = createApiClient({ baseUrl: opts.baseUrl })

    for (;;) {
        opts.onPoll?.()

        // Two-arg .then(): only the POST's own rejection lands in the
        // failure branch — not errors thrown while handling its response.
        const attempt = await client
            .POST('/cli/pairing/exchange', {
                body: { device_code: deviceCode }
            })
            .then(
                (r): ExchangeAttempt => ({
                    ok: true,
                    data: r.data,
                    error: r.error,
                    response: r.response
                }),
                (cause): ExchangeAttempt => ({ ok: false, cause })
            )

        if (!attempt.ok) {
            // The browser wait can run for minutes; a transient network blip
            // must not abort the whole login. A genuine Ctrl-C still does —
            // only other failures keep polling until the deadline.
            const name = (attempt.cause as { name?: string } | null)?.name
            if (name === 'AbortError' && wasInterrupted()) throw attempt.cause
            if (Date.now() >= deadline) {
                const { UsageError } = await import('../errors/errors.js')
                throw new UsageError(
                    'Pairing request expired. Run `chatbase auth login` to try again.'
                )
            }
            await sleep(opts.intervalMs)
            continue
        }
        const { data, error, response } = attempt

        if (response.ok) {
            const result =
                data as components['schemas']['CliPairingExchangeResponse']
            return {
                apiKey: result.api_key,
                workspace: result.workspace
            }
        }

        const errorBody = error as {
            error?: { code?: string }
        }
        const code = errorBody?.error?.code

        if (code === 'PAIRING_PENDING' || code === 'PAIRING_SLOW_DOWN') {
            if (Date.now() >= deadline) {
                const { UsageError } = await import('../errors/errors.js')
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

        throwIfError(response, error)
    }
}
