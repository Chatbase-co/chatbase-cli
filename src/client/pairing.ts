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
import { createApiClient, throwIfError } from './client.js'

export type PairingResult = {
    apiKey: string
    workspace: { id: string; name: string }
}

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
    const d = data as {
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
    const client = createApiClient({ baseUrl: opts.baseUrl })

    for (;;) {
        opts.onPoll?.()
        const { data, error, response } = await client.POST(
            '/cli/pairing/exchange',
            { body: { device_code: deviceCode } }
        )

        if (response.ok) {
            const result = data as {
                api_key: string
                workspace: { id: string; name: string }
            }
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
