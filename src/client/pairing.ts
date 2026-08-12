/**
 * CLI-side of the browser pairing login flow:
 *   1. POST /cli/pairing → get user_code + device_code
 *   2. User approves at verification_uri (opens in browser)
 *   3. Poll POST /cli/pairing/exchange with device_code until approved
 *   4. Receive the minted API key + workspace info
 *
 * The endpoints are unauthenticated (the whole point is the user doesn't
 * have a key yet). Errors use the standard API envelope — PAIRING_PENDING
 * means "keep polling", anything else is terminal.
 */
import os from 'node:os'
import { rawApiFetch } from './client.js'

export type PairingResult = {
    apiKey: string
    workspace: { id: string; name: string }
}

export async function startPairing(opts?: { baseUrl?: string }): Promise<{
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    expiresIn: number
    interval: number
}> {
    const res = await rawApiFetch('POST', '/cli/pairing', {
        baseUrl: opts?.baseUrl,
        body: { device_name: os.hostname() }
    })
    if (res.status !== 201 && res.status !== 200) {
        const { parseErrorResponse } = await import('../errors/errors.js')
        throw parseErrorResponse(res.status, res.body, res.requestId)
    }
    const data = res.body as {
        device_code: string
        user_code: string
        verification_uri: string
        verification_uri_complete: string
        expires_in: number
        interval: number
    }
    return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        verificationUriComplete: data.verification_uri_complete,
        expiresIn: data.expires_in,
        interval: data.interval
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

    for (;;) {
        opts.onPoll?.()
        const res = await rawApiFetch('POST', '/cli/pairing/exchange', {
            baseUrl: opts.baseUrl,
            body: { device_code: deviceCode }
        })

        if (res.status === 200) {
            const data = res.body as {
                api_key: string
                workspace: { id: string; name: string }
            }
            return {
                apiKey: data.api_key,
                workspace: data.workspace
            }
        }

        const errorBody = res.body as {
            error?: { code?: string; message?: string }
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

        const { parseErrorResponse } = await import('../errors/errors.js')
        throw parseErrorResponse(res.status, res.body, res.requestId)
    }
}
