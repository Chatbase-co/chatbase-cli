import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runChatRepl } from '../../src/repl/chat-repl.js'

/** A scripted stdin: writes each line (newline-terminated) then ends the
 * stream, simulating a piped-in session or a user who types and hits Ctrl-D. */
function scripted(lines: string[]): PassThrough {
    const s = new PassThrough()
    setImmediate(() => {
        for (const l of lines) s.write(`${l}\n`)
        s.end()
    })
    return s
}

describe('runChatRepl', () => {
    it('sends lines, tracks conversation id, /id prints it, /exit ends', async () => {
        const sent: string[] = []
        const infos: string[] = []
        const result = await runChatRepl({
            send: async (m) => {
                sent.push(m)
                return { conversationId: 'c_1' }
            },
            retry: async () => {},
            input: scripted(['hello', '/id', '/exit']),
            output: new PassThrough(),
            info: (m) => infos.push(m)
        })
        expect(sent).toEqual(['hello'])
        expect(infos.join('\n')).toContain('c_1')
        expect(result.conversationId).toBe('c_1')
    })

    it('/new clears the conversation id', async () => {
        const convs: Array<string | undefined> = []
        await runChatRepl({
            send: async (_m, c) => {
                convs.push(c)
                return { conversationId: 'c_2' }
            },
            retry: async () => {},
            input: scripted(['a', '/new', 'b', '/exit']),
            output: new PassThrough(),
            info: () => {}
        })
        // second send starts fresh (no conversation id carried over /new)
        expect(convs).toEqual([undefined, undefined])
    })

    it('/retry calls retry with the current conversation', async () => {
        const retried: string[] = []
        await runChatRepl({
            send: async () => ({ conversationId: 'c_3' }),
            retry: async (c) => {
                retried.push(c)
            },
            input: scripted(['x', '/retry', '/exit']),
            output: new PassThrough(),
            info: () => {}
        })
        expect(retried).toEqual(['c_3'])
    })

    it('input stream ending (Ctrl-D) returns the conversation id without /exit', async () => {
        const result = await runChatRepl({
            send: async () => ({ conversationId: 'c_4' }),
            retry: async () => {},
            input: scripted(['hi']),
            output: new PassThrough(),
            info: () => {}
        })
        expect(result.conversationId).toBe('c_4')
    })

    it('prints the greeting on start', async () => {
        const infos: string[] = []
        await runChatRepl({
            send: async () => ({}),
            retry: async () => {},
            input: scripted(['/exit']),
            output: new PassThrough(),
            info: (m) => infos.push(m)
        })
        expect(infos[0]).toContain('/exit')
        expect(infos[0]).toContain('Ctrl-C')
    })

    it('ignores empty lines', async () => {
        const sent: string[] = []
        await runChatRepl({
            send: async (m) => {
                sent.push(m)
                return {}
            },
            retry: async () => {},
            input: scripted(['', '  ', 'hi', '/exit']),
            output: new PassThrough(),
            info: () => {}
        })
        expect(sent).toEqual(['hi'])
    })

    it('/help lists the slash commands', async () => {
        const infos: string[] = []
        await runChatRepl({
            send: async () => ({}),
            retry: async () => {},
            input: scripted(['/help', '/exit']),
            output: new PassThrough(),
            info: (m) => infos.push(m)
        })
        const text = infos.join('\n')
        for (const cmd of ['/exit', '/new', '/retry', '/id', '/help']) {
            expect(text).toContain(cmd)
        }
    })

    it('an unknown slash command prints a hint instead of throwing', async () => {
        const infos: string[] = []
        const sent: string[] = []
        await runChatRepl({
            send: async (m) => {
                sent.push(m)
                return {}
            },
            retry: async () => {},
            input: scripted(['/wat', '/exit']),
            output: new PassThrough(),
            info: (m) => infos.push(m)
        })
        expect(sent).toEqual([])
        expect(infos.some((m) => /unknown/i.test(m))).toBe(true)
    })

    it('/retry with no conversation yet reports an error instead of calling retry', async () => {
        const retried: string[] = []
        const infos: string[] = []
        await runChatRepl({
            send: async () => ({}),
            retry: async (c) => {
                retried.push(c)
            },
            input: scripted(['/retry', '/exit']),
            output: new PassThrough(),
            info: (m) => infos.push(m)
        })
        expect(retried).toEqual([])
        expect(infos.some((m) => /no conversation/i.test(m))).toBe(true)
    })

    it('/id prints "none" before any message has been sent', async () => {
        const infos: string[] = []
        await runChatRepl({
            send: async () => ({}),
            retry: async () => {},
            input: scripted(['/id', '/exit']),
            output: new PassThrough(),
            info: (m) => infos.push(m)
        })
        expect(infos).toContain('none')
    })

    it('seeds an initial conversation id when provided', async () => {
        const convs: Array<string | undefined> = []
        const infos: string[] = []
        await runChatRepl({
            send: async (_m, c) => {
                convs.push(c)
                return {}
            },
            retry: async () => {},
            input: scripted(['/id', 'hi', '/exit']),
            output: new PassThrough(),
            info: (m) => infos.push(m),
            initialConversationId: 'c_seed'
        })
        expect(infos).toContain('c_seed')
        expect(convs).toEqual(['c_seed'])
    })

    it('Ctrl-C during a response cancels only that response, then returns to the prompt', async () => {
        const infos: string[] = []
        let sawSignal: AbortSignal | undefined
        const input = new PassThrough()
        const promise = runChatRepl({
            send: (_m, _c, signal) =>
                new Promise((_resolve, reject) => {
                    sawSignal = signal
                    signal?.addEventListener('abort', () => {
                        const err = new Error('The operation was aborted')
                        err.name = 'AbortError'
                        reject(err)
                    })
                }),
            retry: async () => {},
            input,
            output: new PassThrough(),
            info: (m) => infos.push(m)
        })

        setImmediate(() => input.write('hello\n'))
        // Give send() a chance to be invoked and register its abort listener.
        await new Promise((r) => setTimeout(r, 20))
        expect(sawSignal).toBeInstanceOf(AbortSignal)
        expect(sawSignal?.aborted).toBe(false)

        // The Ctrl-C byte (0x03) — readline (terminal mode) turns this into
        // its own 'SIGINT' event rather than a line of input.
        input.write(String.fromCharCode(3))
        await new Promise((r) => setTimeout(r, 20))
        expect(sawSignal?.aborted).toBe(true)

        input.write('/exit\n')
        const result = await promise
        expect(infos.some((m) => /cancel/i.test(m))).toBe(true)
        expect(result.conversationId).toBeUndefined()
    })

    it('Ctrl-C at an idle prompt exits the REPL', async () => {
        const input = new PassThrough()
        const promise = runChatRepl({
            send: async () => ({}),
            retry: async () => {},
            input,
            output: new PassThrough(),
            info: () => {}
        })
        setImmediate(() => input.write(String.fromCharCode(3)))
        const result = await promise
        expect(result.conversationId).toBeUndefined()
    })
})
