import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import type { BaseFlags } from '../../base/base-command.js'
import { readStdinToEnd } from '../../base/body-input.js'
import {
    type ChatResult,
    extractText,
    retryChat,
    sendChat
} from '../../client/chat-helpers.js'
import { UsageError } from '../../errors/errors.js'
import { startSpinner } from '../../output/spinner.js'
import { runChatRepl } from '../../repl/chat-repl.js'

type ChatFlags = BaseFlags & { agent?: string; conversation?: string }

export default class Chat extends AgentCommand {
    static override description =
        'Send a message to an agent and print its response'
    static override examples = [
        '<%= config.bin %> chat -a agt_123 -m "How do I reset my password?"',
        'echo "summarize our refund policy" | <%= config.bin %> chat -a agt_123',
        '<%= config.bin %> chat -a agt_123 -m "and then?" --conversation conv_123',
        '<%= config.bin %> chat -a agt_123 -m "hi" --no-stream',
        '<%= config.bin %> chat -a agt_123 -m "hi" --json'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        message: Flags.string({
            char: 'm',
            description:
                'Message to send (else read from piped stdin, else an interactive REPL)'
        }),
        conversation: Flags.string({
            description: 'Continue an existing conversation'
        }),
        'no-stream': Flags.boolean({
            description:
                'Wait for the complete response instead of streaming tokens'
        })
    }

    private async resolveMessage(flags: { message?: string }): Promise<string> {
        if (flags.message) return flags.message
        // A TTY with no -m is handled by run() before this is ever called
        // (it goes to the interactive REPL instead), so reaching here with
        // no message means stdin is a pipe that turned out to be empty.
        const piped = await readStdinToEnd()
        if (piped) return piped
        throw new UsageError('No message received on stdin.')
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(Chat)

        if (!flags.message && process.stdin.isTTY) {
            await this.runInteractive(flags)
            return
        }

        // Resolve the message first: it's local (no network), so a failure
        // here doesn't first need working credentials or an agent lookup
        // round trip to fail fast.
        const message = await this.resolveMessage(flags)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        // --json always forces a non-streaming call so the full envelope is
        // available to print in one shot; --no-stream does the same for
        // plain-text output. Otherwise stream tokens as they arrive.
        const stream = !flags.json && !flags['no-stream']

        // Non-streaming waits for the full response — show a spinner after
        // 300ms so short waits never flicker.
        const stop =
            stream || flags.quiet ? () => {} : startSpinner('Typing…', 300)
        let result: ChatResult
        try {
            result = await sendChat({
                client,
                agentId,
                message,
                conversationId: flags.conversation,
                stream,
                onText: stream ? (text) => process.stdout.write(text) : () => {}
            })
        } finally {
            stop()
        }

        if (stream) {
            process.stdout.write('\n')
        } else if (!result.raw) {
            throw new Error('Chat response was empty')
        } else if (flags.json) {
            process.stdout.write(`${JSON.stringify(result.raw, null, 2)}\n`)
            return
        } else {
            process.stdout.write(`${extractText(result.raw)}\n`)
        }
        this.printConversationHint(flags, agentId, result.conversationId)
    }

    /**
     * The interactive REPL path: a TTY with no -m and no piped stdin. Builds
     * the `send`/`retry` deps runChatRepl needs — each wraps `sendChat` with
     * streaming to stdout and forwards the per-call `signal` the REPL
     * creates fresh per turn, so Ctrl-C cancels just that one call instead
     * of the process-wide interrupt signal (which would also poison every
     * later request in the session — see client/signals.ts).
     */
    private async runInteractive(flags: ChatFlags): Promise<void> {
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const send = async (
            message: string,
            conversationId?: string,
            signal?: AbortSignal
        ): Promise<{ conversationId?: string }> => {
            const { conversationId: nextId } = await sendChat({
                client,
                agentId,
                message,
                conversationId,
                stream: true,
                signal,
                onText: (text) => process.stdout.write(text)
            })
            process.stdout.write('\n')
            return { conversationId: nextId }
        }

        // Retries the last message in the conversation. Since the REPL doesn't
        // track individual message IDs, we use "last" as a placeholder that
        // the server interprets as the last message in the conversation.
        const retry = async (
            conversationId: string,
            signal?: AbortSignal
        ): Promise<void> => {
            await retryChat({
                client,
                agentId,
                conversationId,
                messageId: 'last',
                stream: true,
                signal,
                onText: (text) => process.stdout.write(text)
            })
            process.stdout.write('\n')
        }

        const { conversationId } = await runChatRepl({
            send,
            retry,
            input: process.stdin,
            output: process.stdout,
            info: (msg) => this.note(flags, msg),
            initialConversationId: flags.conversation
        })

        this.printConversationHint(flags, agentId, conversationId)
    }

    private printConversationHint(
        flags: { quiet?: boolean },
        agentId: string,
        conversationId?: string
    ): void {
        if (!conversationId) return
        this.note(
            flags,
            `Conversation: ${conversationId} — resume with: chatbase chat -a ${agentId} --conversation ${conversationId}`
        )
    }
}
