import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type UpdateMessageFeedbackRequest =
    components['schemas']['UpdateMessageFeedbackRequest']

export default class MessagesFeedback extends AgentCommand {
    static override description =
        'Set or clear user feedback on an assistant message'
    static override examples = [
        '<%= config.bin %> messages feedback msg_1 --conversation conv_123 --rating positive -a agt_123',
        '<%= config.bin %> messages feedback --conversation conv_123 --message msg_1 --rating clear -a agt_123'
    ]
    static override args = {
        messageId: Args.string({
            required: false,
            description: 'Message ID (alternative to --message)'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        conversation: Flags.string({
            required: true,
            description: 'Conversation ID'
        }),
        message: Flags.string({
            description: 'Message ID'
        }),
        rating: Flags.string({
            required: true,
            options: ['positive', 'negative', 'clear'],
            description: 'Feedback value ("clear" removes existing feedback)'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(MessagesFeedback)
        // Positional and flag are alternatives — `agents get <id>` set the
        // positional convention, the flag predates it and stays supported.
        const messageId = args.messageId ?? flags.message
        if (!messageId) {
            throw new UsageError(
                'Missing message ID. Pass it positionally (`messages feedback <id> ...`) or via --message.'
            )
        }
        if (args.messageId && flags.message) {
            throw new UsageError(
                'Pass the message ID either positionally or via --message, not both.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const feedback: UpdateMessageFeedbackRequest['feedback'] =
            flags.rating === 'positive'
                ? 'positive'
                : flags.rating === 'negative'
                  ? 'negative'
                  : null
        const body: UpdateMessageFeedbackRequest = { feedback }
        const { error, response } = await client.PATCH(
            '/agents/{agentId}/conversations/{conversationId}/messages/{messageId}/feedback',
            {
                params: {
                    path: {
                        agentId,
                        conversationId: flags.conversation,
                        messageId
                    }
                },
                body
            }
        )
        throwIfError(response, error)
        this.success(flags, `Feedback updated for message ${messageId}`)
    }
}
