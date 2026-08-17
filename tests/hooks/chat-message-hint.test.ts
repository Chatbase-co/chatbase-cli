import { describe, expect, it, vi } from 'vitest'
import hook from '../../src/hooks/chat-message-hint.js'

type HookCtx = { error: (msg: string, opts?: { exit?: number }) => never }

function makeCtx() {
    const error = vi.fn((msg: string): never => {
        const err = new Error(msg) as Error & { oclif: { exit: number } }
        err.oclif = { exit: 2 }
        throw err
    })
    return { ctx: { error } as unknown as HookCtx, error }
}

describe('command_not_found hook for chat', () => {
    it('suggests -m when a message is passed positionally to chat', async () => {
        const { ctx, error } = makeCtx()
        await expect(
            // Real oclif shape: the attempted command joined with the
            // internal ':' separator, leftovers in argv.
            // biome-ignore lint/suspicious/noExplicitAny: hook context is oclif-internal
            (hook as any).call(ctx, {
                id: 'chat:what are your hours?',
                argv: []
            })
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        const msg = error.mock.calls[0]?.[0] ?? ''
        expect(msg).toContain('-m')
        expect(msg).toContain('what are your hours?')
    })

    it('handles the id + argv split shape the same way', async () => {
        const { ctx, error } = makeCtx()
        await expect(
            // biome-ignore lint/suspicious/noExplicitAny: hook context is oclif-internal
            (hook as any).call(ctx, { id: 'chat', argv: ['hello', 'there'] })
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(error.mock.calls[0]?.[0] ?? '').toContain('hello there')
    })

    it('stays silent for unknown commands outside the chat topic', async () => {
        const { ctx, error } = makeCtx()
        // biome-ignore lint/suspicious/noExplicitAny: hook context is oclif-internal
        await (hook as any).call(ctx, { id: 'agentz:list', argv: [] })
        expect(error).not.toHaveBeenCalled()
    })
})
