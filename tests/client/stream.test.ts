import { expect, it } from 'vitest'
import { parseSseStream, type StreamEvent } from '../../src/client/stream.js'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder()
    return new ReadableStream({
        start(controller) {
            for (const c of chunks) controller.enqueue(enc.encode(c))
            controller.close()
        }
    })
}

/** Wraps `stream.getReader` so every reader it hands out reports how many
 * times `.cancel()` was called — used to verify parseSseStream releases the
 * reader instead of leaking it. */
function trackReaderCancels(stream: ReadableStream<Uint8Array>): {
    count: number
} {
    const state = { count: 0 }
    const target = stream as unknown as {
        getReader: () => ReadableStreamDefaultReader<Uint8Array>
    }
    const originalGetReader = target.getReader.bind(stream)
    target.getReader = () => {
        const reader = originalGetReader()
        const originalCancel = reader.cancel.bind(reader)
        reader.cancel = (reason?: unknown) => {
            state.count++
            return originalCancel(reason)
        }
        return reader
    }
    return state
}

it('emits text deltas, metadata, and done', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf([
            'data: {"type":"text-delta","delta":"Hel"}\n\n',
            'data: {"type":"text-delta","delta":"lo"}\n\n',
            'data: {"type":"message-metadata","messageMetadata":{"conversationId":"c_9","finishReason":"stop"}}\n\n',
            'data: [DONE]\n\n'
        ]),
        (e) => events.push(e)
    )
    expect(events).toEqual([
        { type: 'text', text: 'Hel' },
        { type: 'text', text: 'lo' },
        { type: 'metadata', conversationId: 'c_9' },
        { type: 'done' }
    ])
})

it('surfaces the assistant messageId from finish metadata', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf([
            'data: {"type":"finish","messageMetadata":{"conversationId":"c_9","messageId":"m_42"}}\n\n',
            'data: [DONE]\n\n'
        ]),
        (e) => events.push(e)
    )
    expect(events[0]).toEqual({
        type: 'metadata',
        conversationId: 'c_9',
        messageId: 'm_42'
    })
})

it('emits an error event for a mid-stream error part', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf([
            'data: {"type":"text-delta","delta":"partial"}\n\n',
            'data: {"type":"error","errorText":"Model exploded"}\n\n',
            'data: [DONE]\n\n'
        ]),
        (e) => events.push(e)
    )
    expect(events).toEqual([
        { type: 'text', text: 'partial' },
        { type: 'error', message: 'Model exploded' },
        { type: 'done' }
    ])
})

it('emits a warning for an unparseable data payload and keeps parsing', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf([
            'data: {broken json\n\n',
            'data: {"type":"text-delta","delta":"still here"}\n\n',
            'data: [DONE]\n\n'
        ]),
        (e) => events.push(e)
    )
    expect(events[0]?.type).toBe('warning')
    expect(events[1]).toEqual({ type: 'text', text: 'still here' })
})

it('handles events split across chunk boundaries', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf([
            'data: {"type":"text-del',
            'ta","delta":"x"}\n\ndata: [DONE]\n\n'
        ]),
        (e) => events.push(e)
    )
    expect(events[0]).toEqual({ type: 'text', text: 'x' })
})

it('ignores unknown part types', async () => {
    const events: StreamEvent[] = []
    await parseSseStream(
        streamOf(['data: {"type":"future-thing"}\n\ndata: [DONE]\n\n']),
        (e) => events.push(e)
    )
    expect(events).toEqual([{ type: 'done' }])
})

it('rejects on idle timeout', async () => {
    const never = new ReadableStream<Uint8Array>({ start() {} })
    await expect(
        parseSseStream(never, () => {}, { idleTimeoutMs: 50 })
    ).rejects.toThrow(/idle/i)
})

it('includes the actual configured idle timeout in the error message', {
    timeout: 3000
}, async () => {
    const never = new ReadableStream<Uint8Array>({ start() {} })
    await expect(
        parseSseStream(never, () => {}, { idleTimeoutMs: 1500 })
    ).rejects.toThrow(/no data for 2s/)
})

it('releases the reader after [DONE]', async () => {
    const stream = streamOf(['data: [DONE]\n\n'])
    const cancels = trackReaderCancels(stream)
    await parseSseStream(stream, () => {})
    expect(cancels.count).toBe(1)
})

it('releases the reader when the stream ends without [DONE]', async () => {
    const stream = streamOf(['data: {"type":"text-delta","delta":"x"}\n\n'])
    const cancels = trackReaderCancels(stream)
    await parseSseStream(stream, () => {})
    expect(cancels.count).toBe(1)
})

it('releases the reader when the idle timeout rejects', async () => {
    const never = new ReadableStream<Uint8Array>({ start() {} })
    const cancels = trackReaderCancels(never)
    await expect(
        parseSseStream(never, () => {}, { idleTimeoutMs: 20 })
    ).rejects.toThrow()
    expect(cancels.count).toBe(1)
})
