import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import type { BaseFlags } from '../../base/base-command.js'
import { readStdinToEnd } from '../../base/body-input.js'
import {
    fetchRecentHistory,
    retryChat,
    runChatTurn,
    sendChat
} from '../../client/chat-helpers.js'
import { UsageError } from '../../errors/errors.js'
import { maybeSpinner } from '../../output/spinner.js'
import { runChatRepl } from '../../repl/chat-repl.js'

type ChatFlags = BaseFlags & {
    agent?: string
    conversation?: string
    resume?: boolean
}

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
        resume: Flags.boolean({
            description:
                'Replay the last few messages when continuing a conversation',
            dependsOn: ['conversation']
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
        const piped = (await readStdinToEnd()).trim()
        if (piped) return piped
        throw new UsageError('No message received on stdin.')
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(Chat)

        if (!flags.message && process.stdin.isTTY) {
            await this.runInteractive(flags)
            return
        }

        if (flags.resume) {
            this.note(
                flags,
                this.palette(flags).yellow(
                    '! --resume only replays history in the interactive REPL (a TTY with no -m) — ignored here.'
                )
            )
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

        const result = await runChatTurn({
            stream,
            quiet: flags.quiet,
            json: flags.json,
            call: (onText) =>
                sendChat({
                    client,
                    agentId,
                    message,
                    conversationId: flags.conversation,
                    stream,
                    onText
                })
        })
        if (!flags.json) {
            this.printConversationHint(flags, agentId, result.conversationId)
        }
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

        // --resume replays the tail of the conversation so the user sees
        // where they left off. Best-effort: a failed history fetch must
        // not block the chat itself.
        if (flags.conversation && flags.resume) {
            try {
                const history = await fetchRecentHistory({
                    client,
                    agentId,
                    conversationId: flags.conversation
                })
                if (history.length > 0) {
                    const dim = this.palette(flags).dim
                    this.note(flags, dim(`— resuming ${flags.conversation} —`))
                    for (const line of history) {
                        const who = line.role === 'user' ? 'you' : 'agent'
                        this.note(flags, dim(`${who}: ${line.text}`))
                    }
                    this.note(flags, dim('—'))
                }
            } catch (err) {
                // Still best-effort — the conversation continues either way —
                // but a bad --conversation id and "no history yet" must not
                // look identical.
                const detail = err instanceof Error ? err.message : String(err)
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        `! Could not load history for ${flags.conversation} (${detail}) — continuing without it.`
                    )
                )
            }
        }

        // Streaming still has time-to-first-token dead air — spin until the
        // first token arrives, then let the tokens themselves be the feedback.
        const spinUntilFirstToken = () => {
            const stop = maybeSpinner(flags.quiet, 'Thinking…', 300)
            let stopped = false
            return () => {
                if (stopped) return
                stopped = true
                stop()
            }
        }

        // The server returns the assistant message id in the stream's finish
        // metadata — remember it so /retry has a real id to send. The retry
        // endpoint truncates the conversation at that message and re-sends
        // the user message before it; there is no "last" sentinel.
        let lastMessageId: string | undefined

        const send = async (
            message: string,
            conversationId?: string,
            signal?: AbortSignal
        ): Promise<{ conversationId?: string }> => {
            const stop = spinUntilFirstToken()
            try {
                const { conversationId: nextId, messageId } = await sendChat({
                    client,
                    agentId,
                    message,
                    conversationId,
                    stream: true,
                    signal,
                    onText: (text) => {
                        stop()
                        process.stdout.write(text)
                    }
                })
                lastMessageId = messageId ?? lastMessageId
                process.stdout.write('\n')
                return { conversationId: nextId }
            } finally {
                stop()
            }
        }

        const retry = async (
            conversationId: string,
            signal?: AbortSignal
        ): Promise<void> => {
            if (!lastMessageId) {
                // Cold /retry on a --conversation the REPL just resumed:
                // nothing sent this session yet, so look up the last
                // assistant message (history returns the recent tail —
                // enough, since /retry targets the latest response).
                const history = await fetchRecentHistory({
                    client,
                    agentId,
                    conversationId
                })
                const lastAssistant = [...history]
                    .reverse()
                    .find((line) => line.role === 'assistant' && line.id)
                if (!lastAssistant) {
                    throw new UsageError(
                        'Nothing to retry yet in this conversation — send a message first.'
                    )
                }
                lastMessageId = lastAssistant.id
            }
            const stop = spinUntilFirstToken()
            try {
                const { messageId } = await retryChat({
                    client,
                    agentId,
                    conversationId,
                    messageId: lastMessageId,
                    stream: true,
                    signal,
                    onText: (text) => {
                        stop()
                        process.stdout.write(text)
                    }
                })
                lastMessageId = messageId ?? lastMessageId
                process.stdout.write('\n')
            } finally {
                stop()
            }
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
}
