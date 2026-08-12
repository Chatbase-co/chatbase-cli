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
        { type: 'metadata', conversationId: 'c_9', finishReason: 'stop' },
        { type: 'done' }
    ])
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
