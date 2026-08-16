import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import {
    type ChatResult,
    extractText,
    retryChat
} from '../../client/chat-helpers.js'
import { startSpinner } from '../../output/spinner.js'

export default class ChatRetry extends AgentCommand {
    static override description = 'Retry generating an assistant response'
    static override examples = [
        '<%= config.bin %> chat retry --conversation c_123 -a agt_123 --message-id msg_456',
        '<%= config.bin %> chat retry --conversation c_123 -a agt_123 --message-id msg_456 --no-stream'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        conversation: Flags.string({
            description: 'The conversation ID to retry in',
            required: true
        }),
        'message-id': Flags.string({
            description: 'The message ID to retry from',
            required: true
        }),
        'no-stream': Flags.boolean({
            description:
                'Wait for the complete response instead of streaming tokens'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ChatRetry)

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        // --json always forces a non-streaming call so the full envelope is
        // available to print in one shot; --no-stream does the same for
        // plain-text output. Otherwise stream tokens as they arrive.
        const stream = !flags.json && !flags['no-stream']

        const stop =
            stream || flags.quiet ? () => {} : startSpinner('Typing…', 300)
        let result: ChatResult
        try {
            result = await retryChat({
                client,
                agentId,
                conversationId: flags.conversation as string,
                messageId: flags['message-id'] as string,
                stream,
                onText: stream ? (text) => process.stdout.write(text) : () => {}
            })
        } finally {
            stop()
        }

        if (stream) {
            process.stdout.write('\n')
        } else if (!result.raw) {
            throw new Error('Retry response was empty')
        } else if (flags.json) {
            process.stdout.write(`${JSON.stringify(result.raw, null, 2)}\n`)
            return
        } else {
            process.stdout.write(`${extractText(result.raw)}\n`)
        }
        this.printConversationHint(flags, agentId, result.conversationId)
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
