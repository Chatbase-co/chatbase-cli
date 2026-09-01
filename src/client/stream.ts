/**
 * Hand-rolled SSE parser (~50 lines) instead of a library (e.g. eventsource-parser)
 * because SSE is trivial (`data: <json>\n\n`) and the real work is Chatbase-specific:
 * idle-timeout racing and mapping our event types (text-delta, message-metadata).
 * A library would replace ~15 lines of string splitting and add a dependency to maintain.
 */

export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'metadata'; conversationId?: string; messageId?: string }
    /** A server-side generation failure delivered mid-stream — the response
     * is already 200 by then, so this event is the only failure signal. */
    | { type: 'error'; message: string }
    /** A `data:` payload that was not valid JSON. The stream continues, but
     * the caller should say so rather than present a silent gap. */
    | { type: 'warning'; message: string }
    | { type: 'done' }

export async function parseSseStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (e: StreamEvent) => void,
    opts: { idleTimeoutMs?: number } = {}
): Promise<void> {
    const idleMs = opts.idleTimeoutMs ?? 60_000
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        for (;;) {
            let timer: ReturnType<typeof setTimeout> | undefined
            const idle = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    const seconds = Math.round(idleMs / 1000)
                    reject(
                        new Error(
                            `Stream idle timeout — no data for ${seconds}s`
                        )
                    )
                }, idleMs)
            })
            const result = await Promise.race([reader.read(), idle]).finally(
                () => clearTimeout(timer)
            )
            const { done, value } =
                result as ReadableStreamReadResult<Uint8Array>
            if (done) return
            buffer += decoder.decode(value, { stream: true })
            for (;;) {
                const idx = buffer.indexOf('\n\n')
                if (idx === -1) break
                const block = buffer.slice(0, idx)
                buffer = buffer.slice(idx + 2)
                for (const line of block.split('\n')) {
                    if (!line.startsWith('data: ')) continue
                    const payload = line.slice(6)
                    if (payload === '[DONE]') {
                        onEvent({ type: 'done' })
                        return
                    }
                    let part: Record<string, unknown>
                    try {
                        part = JSON.parse(payload) as Record<string, unknown>
                    } catch {
                        onEvent({
                            type: 'warning',
                            message: 'Skipped an unparseable stream chunk'
                        })
                        continue
                    }
                    if (
                        part.type === 'text-delta' &&
                        typeof part.delta === 'string'
                    ) {
                        onEvent({ type: 'text', text: part.delta })
                    } else if (part.type === 'error') {
                        onEvent({
                            type: 'error',
                            message:
                                typeof part.errorText === 'string'
                                    ? part.errorText
                                    : 'The agent stopped with an error'
                        })
                    } else if (
                        part.type === 'message-metadata' ||
                        part.type === 'finish'
                    ) {
                        const meta = (part.messageMetadata ?? {}) as {
                            conversationId?: string
                            messageId?: string
                        }
                        onEvent({
                            type: 'metadata',
                            conversationId: meta.conversationId,
                            messageId: meta.messageId
                        })
                    }
                }
            }
        }
    } finally {
        await reader.cancel().catch(() => {})
    }
}
