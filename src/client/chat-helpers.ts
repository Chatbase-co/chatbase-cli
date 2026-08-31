import type { Client } from 'openapi-fetch'
import { ApiError } from '../errors/errors.js'
import type { components, paths } from '../generated/api.js'
import { maybeSpinner } from '../output/spinner.js'
import { throwIfError } from './client.js'
import { parseSseStream } from './stream.js'

/** The `{ data: ChatResponse }` envelope returned by non-streaming chat calls. */
export type ChatResponseEnvelope = {
    data: components['schemas']['ChatResponse']
}

/**
 * Strips C0/C1 control characters (keeping only \t and \n) from text that
 * came back from the API. Agent replies and replayed user messages are
 * attacker-influenceable, and raw ESC/OSC bytes reaching a terminal are an
 * injection primitive (OSC 52 clipboard writes, cursor/erase spoofing, \r
 * line overwrites). Safe to apply per streamed chunk: removing the ESC byte
 * defuses a sequence even when it is split across two deltas — the tail
 * prints as inert ASCII. `--json` output is unaffected (JSON.stringify
 * already escapes these), so raw fidelity remains available.
 */
export function sanitizeAgentText(text: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
}

/**
 * Joins every `text` part of a non-streaming ChatResponse into one string.
 * Tool-call/tool-result parts are skipped.
 */
export function extractText(envelope: ChatResponseEnvelope): string {
    return sanitizeAgentText(
        envelope.data.parts
            .filter((part) => part.type === 'text')
            .map((part) => (part as { text: string }).text)
            .join('')
    )
}

/** Discriminated on `stream` so `raw` is only ever present for a
 * non-streaming call — callers narrow on the flag they already have
 * instead of re-checking `raw` at runtime. messageId is the assistant
 * message the server produced — the id the REPL's /retry and `chat retry`
 * must pass back. */
export type ChatResult =
    | {
          stream: false
          raw: ChatResponseEnvelope
          conversationId?: string
          messageId?: string
      }
    | { stream: true; conversationId?: string; messageId?: string }

/** Shared response handling for both sendChat and retryChat. `emptyMessage`
 * names the caller in the error for the one failure this function can't
 * recover from (a 2xx non-streaming response with no body) — thrown once
 * here instead of every caller re-checking `!result.raw`. */
async function handleResponse(
    data: unknown,
    error: unknown,
    response: Response,
    stream: boolean,
    onText: (text: string) => void,
    emptyMessage: string
): Promise<ChatResult> {
    if (!stream) {
        throwIfError(response, error)
        const raw = data as unknown as ChatResponseEnvelope | undefined
        if (!raw) throw new Error(emptyMessage)
        return {
            stream: false,
            raw,
            conversationId: raw.data?.metadata?.conversationId,
            messageId: raw.data?.id
        }
    }

    // With parseAs: 'stream', openapi-fetch drains the body into `error`
    // on non-2xx — re-reading response.json() would throw (already consumed).
    if (!response.ok) throwIfError(response, error)

    const body = data as unknown as ReadableStream<Uint8Array> | null
    if (!body) throw new Error('Stream response had no body')

    let conversationId: string | undefined
    let messageId: string | undefined
    let streamError: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(sanitizeAgentText(event.text))
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
            messageId = event.messageId ?? messageId
        }
        if (event.type === 'warning') {
            process.stderr.write(
                `! ${event.message} — response may be incomplete\n`
            )
        }
        if (event.type === 'error') streamError = event.message
    })
    // Throwing AFTER the stream drains keeps parseSseStream's reader
    // cleanup on its normal path and lets text that arrived before the
    // failure still reach the user. The response was already 200 when the
    // failure happened, so this mid-stream event is the only error signal.
    if (streamError) {
        throw new ApiError({
            code: 'STREAM_ERROR',
            message: sanitizeAgentText(streamError),
            status: 200
        })
    }
    return { stream: true, conversationId, messageId }
}

/**
 * The one-shot chat/retry turn both commands share: spinner for the
 * non-streaming wait, run `call`, then print the result — streamed tokens
 * already went to stdout, so finish the line; otherwise print the JSON
 * envelope or the extracted plain text.
 */
export async function runChatTurn(opts: {
    stream: boolean
    quiet?: boolean
    json?: boolean
    call: (onText: (text: string) => void) => Promise<ChatResult>
}): Promise<ChatResult> {
    const stop = maybeSpinner(opts.stream || opts.quiet, 'Thinking…', 300)
    let result: ChatResult
    try {
        result = await opts.call(
            opts.stream ? (text) => process.stdout.write(text) : () => {}
        )
    } finally {
        stop()
    }

    if (result.stream) {
        process.stdout.write('\n')
    } else if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.raw, null, 2)}\n`)
    } else {
        process.stdout.write(`${extractText(result.raw)}\n`)
    }
    return result
}

/** Send a message. Shared by the chat command, the REPL, and chat retry. */
export async function sendChat(opts: {
    client: Client<paths>
    agentId: string
    message: string
    conversationId?: string
    stream: boolean
    onText: (text: string) => void
    signal?: AbortSignal
}): Promise<ChatResult> {
    const { data, error, response } = await opts.client.POST(
        '/agents/{agentId}/chat',
        {
            params: { path: { agentId: opts.agentId } },
            body: {
                message: opts.message,
                conversationId: opts.conversationId,
                stream: opts.stream
            },
            parseAs: opts.stream ? 'stream' : 'json',
            signal: opts.signal
        }
    )
    return handleResponse(
        data,
        error,
        response,
        opts.stream,
        opts.onText,
        'Chat response was empty'
    )
}

/** Retry generating a response for a specific message. */
export async function retryChat(opts: {
    client: Client<paths>
    agentId: string
    conversationId: string
    messageId: string
    stream: boolean
    onText: (text: string) => void
    signal?: AbortSignal
}): Promise<ChatResult> {
    const { data, error, response } = await opts.client.POST(
        '/agents/{agentId}/conversations/{conversationId}/retry',
        {
            params: {
                path: {
                    agentId: opts.agentId,
                    conversationId: opts.conversationId
                }
            },
            body: {
                messageId: opts.messageId,
                stream: opts.stream
            },
            parseAs: opts.stream ? 'stream' : 'json',
            signal: opts.signal
        }
    )
    return handleResponse(
        data,
        error,
        response,
        opts.stream,
        opts.onText,
        'Retry response was empty'
    )
}

/** One line of replayed conversation history for the resume banner (and
 * the REPL's cold-/retry lookup, which needs the message id). */
export type HistoryLine = { id: string; role: string; text: string }

/**
 * Fetches the last `count` messages of a conversation, oldest first, for
 * the --resume banner. Non-text parts are skipped; long messages are
 * truncated — this is orientation, not a transcript.
 */
export async function fetchRecentHistory(opts: {
    client: Client<paths>
    agentId: string
    conversationId: string
    count?: number
    maxChars?: number
}): Promise<HistoryLine[]> {
    const count = opts.count ?? 6
    const maxChars = opts.maxChars ?? 200
    const { data, error, response } = await opts.client.GET(
        '/agents/{agentId}/conversations/{conversationId}/messages',
        {
            params: {
                path: {
                    agentId: opts.agentId,
                    conversationId: opts.conversationId
                },
                query: {}
            }
        }
    )
    throwIfError(response, error)
    const items = (data as { data?: unknown[] } | undefined)?.data ?? []
    return items.slice(-count).map((m) => {
        const msg = m as {
            id?: string
            role?: string
            parts?: Array<{ type?: string; text?: string }>
        }
        const text = sanitizeAgentText(
            (msg.parts ?? [])
                .filter((p) => p.type === 'text' && typeof p.text === 'string')
                .map((p) => p.text)
                .join('')
        )
            .replace(/\s+/g, ' ')
            .trim()
        return {
            id: msg.id ?? '',
            role: msg.role ?? 'unknown',
            text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
        }
    })
}
