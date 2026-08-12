import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'

export default class MessagesFeedback extends AgentCommand {
    static override description =
        'Set or clear user feedback on an assistant message'
    static override examples = [
        '<%= config.bin %> messages feedback --conversation conv_123 --message msg_1 --rating positive -a agt_123',
        '<%= config.bin %> messages feedback --conversation conv_123 --message msg_1 --rating clear -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        conversation: Flags.string({
            required: true,
            description: 'Conversation ID'
        }),
        message: Flags.string({
            required: true,
            description: 'Message ID'
        }),
        rating: Flags.string({
            required: true,
            options: ['positive', 'negative', 'clear'],
            description: 'Feedback value ("clear" removes existing feedback)'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(MessagesFeedback)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const feedback = flags.rating === 'clear' ? null : flags.rating
        const { error, response } = await client.PATCH(
            '/agents/{agentId}/conversations/{conversationId}/messages/{messageId}/feedback',
            {
                params: {
                    path: {
                        agentId,
                        conversationId: flags.conversation,
                        messageId: flags.message
                    }
                },
                body: { feedback } as never
            }
        )
        throwIfError(response, error)
        this.success(flags, `Feedback updated for message ${flags.message}`)
    }
}
