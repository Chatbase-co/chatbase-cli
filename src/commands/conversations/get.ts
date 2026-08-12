import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'title', header: 'TITLE' },
    { key: 'status', header: 'STATUS' },
    { key: 'createdAt', header: 'CREATED' },
    { key: 'updatedAt', header: 'UPDATED' }
]

export default class ConversationsGet extends AgentCommand {
    static override description = 'Show one conversation'
    static override examples = [
        '<%= config.bin %> conversations get --conversation conv_123 -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        conversation: Flags.string({
            required: true,
            description: 'Conversation ID'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsGet)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/conversations/{conversationId}',
            {
                params: {
                    path: { agentId, conversationId: flags.conversation }
                }
            }
        )
        throwIfError(response, error)
        // GetConversationResponse wraps the conversation (with nested
        // messages) in { data, pagination }; --json prints that whole
        // envelope as-is, but the display row only needs the metadata
        // fields shared with `conversations list`.
        const conversation = (data as { data: Record<string, unknown> }).data
        this.printData(
            flags,
            data,
            [
                {
                    id: String(conversation.id ?? ''),
                    title: String(conversation.title ?? ''),
                    status: String(conversation.status ?? ''),
                    createdAt: String(conversation.createdAt ?? ''),
                    updatedAt: String(conversation.updatedAt ?? '')
                }
            ],
            COLUMNS
        )
    }
}
