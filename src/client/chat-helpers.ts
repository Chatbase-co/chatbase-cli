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
 * Tool-call/tool-result parts are skipped — the one-shot `--no-stream` path
 * only prints the assistant's text, matching what the streaming path prints
 * as tokens arrive.
 */
export function extractText(envelope: ChatResponseEnvelope): string {
    return envelope.data.parts
        .filter((part) => part.type === 'text')
        .map((part) => (part as { text: string }).text)
        .join('')
}

/**
 * Sends one message to POST /agents/{agentId}/chat and either streams text
 * deltas to `onText` as they arrive (stream: true) or waits for the full
 * JSON response (stream: false). Shared by the one-shot `chat` command, the
 * REPL, and `chat retry` — kept free of any CLI/output concerns so all three
 * can wrap it differently.
 *
 * The real request body is `{ message, conversationId, stream }` — a single
 * string `message`, not a `messages[]` array — per generated ChatRequest.
 */
export async function sendChat(opts: {
    client: Client<paths>
    agentId: string
    message: string
    conversationId?: string
    stream: boolean
    onText: (text: string) => void
}): Promise<{ conversationId?: string; raw?: unknown }> {
    const { data, error, response } = await opts.client.POST(
        '/agents/{agentId}/chat',
        {
            params: { path: { agentId: opts.agentId } },
            body: {
                message: opts.message,
                conversationId: opts.conversationId,
                stream: opts.stream
            },
            parseAs: opts.stream ? 'stream' : 'json'
        }
    )

    if (!opts.stream) {
        throwIfError(response, error)
        const raw = data as unknown as ChatResponseEnvelope
        return { raw, conversationId: raw?.data?.metadata?.conversationId }
    }

    // Even with parseAs: 'stream', openapi-fetch only takes the streaming
    // branch when response.ok — on a non-2xx it already drained the body
    // into `error` (text, JSON-parsed when possible), so throwIfError can
    // use it directly. Re-reading response.json() here would throw, since
    // the body was already consumed.
    if (!response.ok) throwIfError(response, error)

    const body = data as unknown as ReadableStream<Uint8Array> | null
    if (!body) throw new Error('Chat stream response had no body')

    let conversationId: string | undefined
    await parseSseStream(body, (event) => {
        if (event.type === 'text') opts.onText(event.text)
        if (event.type === 'metadata') {
            conversationId = event.conversationId ?? conversationId
        }
    })
    return { conversationId }
}
