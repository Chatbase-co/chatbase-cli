import readline from 'node:readline'

export type ChatReplDeps = {
    /** Sends one message and streams its response; resolves with the
     * conversation id the server assigned (or reused). `signal` is a fresh
     * per-call AbortController's signal — aborting it cancels only this
     * one call, wired up by the REPL's own Ctrl-C handling below. */
    send: (
        message: string,
        conversationId?: string,
        signal?: AbortSignal
    ) => Promise<{ conversationId?: string }>
    /** Re-runs the last response for `conversationId`. Same per-call signal
     * contract as `send`. */
    retry: (conversationId: string, signal?: AbortSignal) => Promise<void>
    input: NodeJS.ReadableStream
    output: NodeJS.WritableStream
    info: (msg: string) => void
    /** Seeds the REPL's conversation id — lets `chatbase chat --conversation
     * <id>` resume an existing conversation interactively instead of
     * always starting fresh. */
    initialConversationId?: string
}

const GREETING =
    'Type /exit or press Ctrl-D to quit. Ctrl-C cancels a response. /help for commands.'

const HELP_LINES = [
    '/exit    Quit the REPL (same as Ctrl-D)',
    '/new     Start a fresh conversation (clears the current conversation id)',
    '/retry   Regenerate the last response (replaces it in the conversation)',
    '/id      Print the current conversation id',
    '/help    Show this list'
]

/** True for the AbortError a cancelled `send`/`retry` call rejects with —
 * matches the same duck-typed check `classifyError` uses in base-command.ts. */
function isAbortError(err: unknown): boolean {
    return (err as { name?: string } | null | undefined)?.name === 'AbortError'
}

/**
 * Runs the interactive chat REPL. Dependency-injected (send/retry/input/
 * output/info) so tests can drive it with fake streams and fake network
 * calls — the `chat` command wires real stdin/stdout and `sendChat`.
 *
 * Ctrl-C semantics: readline is created with `terminal: true` so it parses
 * Ctrl-C (byte 0x03) itself and emits its own 'SIGINT' event, distinct from
 * the process-wide SIGINT the rest of the CLI listens for (see
 * client/signals.ts) — forcing `terminal: true` is what makes this
 * intercept work even over the plain PassThrough streams used in tests,
 * not just a real TTY. While a `send`/`retry` call is in flight, that event
 * aborts *that call's own* AbortController only; at an idle prompt (nothing
 * in flight) it exits the REPL, same as /exit.
 */
export async function runChatRepl(
    deps: ChatReplDeps
): Promise<{ conversationId?: string }> {
    const { send, retry, input, output, info } = deps
    let conversationId = deps.initialConversationId
    let currentController: AbortController | undefined

    const rl = readline.createInterface({
        input,
        output,
        terminal: true,
        prompt: '> '
    })

    rl.on('SIGINT', () => {
        if (currentController) {
            currentController.abort()
            return
        }
        rl.close()
    })

    /** Runs `fn` under a fresh per-call AbortController wired to the
     * readline-level Ctrl-C above. Swallows the resulting AbortError (and
     * any other failure) so one bad turn never crashes the whole REPL —
     * it prints a note via `info` and returns to the prompt either way. */
    async function cancelable<T>(
        fn: (signal: AbortSignal) => Promise<T>
    ): Promise<T | undefined> {
        const controller = new AbortController()
        currentController = controller
        try {
            return await fn(controller.signal)
        } catch (err) {
            // A cancelled or failed call may have already streamed partial
            // text straight to `output` with no trailing newline (send/retry
            // write tokens as they arrive) — start the note on its own line.
            output.write('\n')
            if (isAbortError(err)) {
                info('[cancelled — response was interrupted]')
            } else {
                info(`✗ ${(err as Error)?.message ?? err}`)
            }
            return undefined
        } finally {
            currentController = undefined
        }
    }

    info(GREETING)
    rl.prompt()

    for await (const rawLine of rl) {
        const line = rawLine.trim()
        if (line === '') {
            rl.prompt()
            continue
        }

        if (line.startsWith('/')) {
            const cmd = line.split(/\s+/, 1)[0]
            if (cmd === '/exit') break
            if (cmd === '/new') {
                conversationId = undefined
            } else if (cmd === '/retry') {
                if (!conversationId) {
                    info('No conversation yet — send a message first.')
                } else {
                    await cancelable((signal) =>
                        retry(conversationId as string, signal)
                    )
                }
            } else if (cmd === '/id') {
                info(conversationId ?? 'none')
            } else if (cmd === '/help') {
                for (const helpLine of HELP_LINES) info(helpLine)
            } else {
                info(`Unknown command: ${cmd} — type /help for a list.`)
            }
            rl.prompt()
            continue
        }

        const result = await cancelable((signal) =>
            send(line, conversationId, signal)
        )
        if (result?.conversationId) conversationId = result.conversationId
        rl.prompt()
    }

    rl.close()
    return { conversationId }
}
