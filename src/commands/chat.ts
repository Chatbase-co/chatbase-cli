import { Flags } from '@oclif/core'
import { AgentCommand } from '../base/agent-command.js'
import {
    type ChatResponseEnvelope,
    extractText,
    sendChat
} from '../client/chat-helpers.js'
import { UsageError } from '../errors/errors.js'

async function readStdinToEnd(): Promise<string> {
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data.trim()
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
        'no-stream': Flags.boolean({
            description:
                'Wait for the complete response instead of streaming tokens'
        })
    }

    private async resolveMessage(flags: { message?: string }): Promise<string> {
        if (flags.message) return flags.message
        if (!process.stdin.isTTY) {
            const piped = await readStdinToEnd()
            if (piped) return piped
            throw new UsageError('No message received on stdin.')
        }
        throw new UsageError(
            'REPL arrives in the next task — use -m or pipe a message'
        )
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(Chat)
        // Resolve the message first: it's local (no network), so a
        // TTY-with-no-message failure doesn't first need working credentials
        // or an agent lookup round trip to fail fast.
        const message = await this.resolveMessage(flags)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        // --json always forces a non-streaming call so the full envelope is
        // available to print in one shot; --no-stream does the same for
        // plain-text output. Otherwise stream tokens as they arrive.
        const stream = !flags.json && !flags['no-stream']

        if (stream) {
            const { conversationId } = await sendChat({
                client,
                agentId,
                message,
                conversationId: flags.conversation,
                stream: true,
                onText: (text) => process.stdout.write(text)
            })
            process.stdout.write('\n')
            this.printConversationHint(flags, agentId, conversationId)
            return
        }

        const { raw, conversationId } = await sendChat({
            client,
            agentId,
            message,
            conversationId: flags.conversation,
            stream: false,
            onText: () => {}
        })

        if (flags.json) {
            process.stdout.write(`${JSON.stringify(raw, null, 2)}\n`)
            return
        }
        process.stdout.write(`${extractText(raw as ChatResponseEnvelope)}\n`)
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
