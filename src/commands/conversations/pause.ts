import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'status', header: 'STATUS' }
]

export default class ConversationsPause extends AgentCommand {
    static override description = 'Pause a conversation'
    static override examples = [
        '<%= config.bin %> conversations pause conv_123 -a agt_123',
        '<%= config.bin %> conversations pause --conversation conv_123 -a agt_123'
    ]
    static override args = {
        conversationId: Args.string({
            required: false,
            description: 'Conversation ID (alternative to --conversation)'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        conversation: Flags.string({
            description: 'Conversation ID'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConversationsPause)
        const conversationId = args.conversationId ?? flags.conversation
        if (!conversationId) {
            throw new UsageError(
                'Missing conversation ID. Pass it positionally (`conversations pause <id>`) or via --conversation.'
            )
        }
        if (args.conversationId && flags.conversation) {
            throw new UsageError(
                'Pass the conversation ID either positionally or via --conversation, not both.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.PATCH(
            '/agents/{agentId}/conversations/{conversationId}',
            {
                params: { path: { agentId, conversationId } },
                body: { paused: true }
            }
        )
        throwIfError(response, error)
        const conv = (data as { data: { id: string; status: string } }).data
        this.printData(
            flags,
            data,
            [{ id: conv.id, status: conv.status }],
            COLUMNS
        )
    }
}
