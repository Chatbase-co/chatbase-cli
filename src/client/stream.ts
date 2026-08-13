export type StreamEvent =
    | { type: 'text'; text: string }
    | { type: 'tool'; name: string }
    | { type: 'metadata'; conversationId?: string; finishReason?: string }
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
                        continue
                    }
                    if (
                        part.type === 'text-delta' &&
                        typeof part.delta === 'string'
                    ) {
                        onEvent({ type: 'text', text: part.delta })
                    } else if (
                        part.type === 'message-metadata' ||
                        part.type === 'finish'
                    ) {
                        const meta = (part.messageMetadata ?? {}) as {
                            conversationId?: string
                            finishReason?: string
                        }
                        onEvent({
                            type: 'metadata',
                            conversationId: meta.conversationId,
                            finishReason: meta.finishReason
                        })
                    } else if (
                        typeof part.type === 'string' &&
                        part.type.startsWith('tool-')
                    ) {
                        onEvent({
                            type: 'tool',
                            name: String(part.toolName ?? part.type)
                        })
                    }
                }
            }
        }
    } finally {
        await reader.cancel().catch(() => {})
    }
}
