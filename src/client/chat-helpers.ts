import type { Client } from 'openapi-fetch'
import type { components, paths } from '../generated/api.js'
import { throwIfError } from './client.js'
import { parseSseStream } from './stream.js'

/** The `{ data: ChatResponse }` envelope returned by non-streaming chat calls. */
export type ChatResponseEnvelope = {
    data: components['schemas']['ChatResponse']
}

/**
 * Joins every `text` part of a non-streaming ChatResponse into one string.
 * Tool-call/tool-result parts are skipped.
 */
export function extractText(envelope: ChatResponseEnvelope): string {
    return envelope.data.parts
        .filter((part) => part.type === 'text')
        .map((part) => (part as { text: string }).text)
        .join('')
}

type ChatResult = { conversationId?: string; raw?: unknown }

/** Shared response handling for both sendChat and retryChat. */
async function handleResponse(
    data: unknown,
    error: unknown,
    response: Response,
    stream: boolean,
    onText: (text: string) => void
): Promise<ChatResult> {
    if (!stream) {
        throwIfError(response, error)
        const raw = data as unknown as ChatResponseEnvelope
        return { raw, conversationId: raw?.data?.metadata?.conversationId }
    }

    // With parseAs: 'stream', openapi-fetch drains the body into `error`
    // on non-2xx — re-reading response.json() would throw (already consumed).
    if (!response.ok) throwIfError(response, error)

    const body = data as unknown as ReadableStream<Uint8Array> | null
    if (!body) throw new Error('Stream response had no body')

    let conversationId: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') onText(event.text)
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
        }
    })
    return { conversationId }
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
    return handleResponse(data, error, response, opts.stream, opts.onText)
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
    return handleResponse(data, error, response, opts.stream, opts.onText)
}
