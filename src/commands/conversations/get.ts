import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import { type Column, formatEpochSeconds } from '../../output/render.js'

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
        '<%= config.bin %> conversations get conv_123 -a agt_123',
        '<%= config.bin %> conversations get --conversation conv_123 -a agt_123'
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
        const { args, flags } = await this.parse(ConversationsGet)
        // Positional and flag are alternatives — `agents get <id>` set the
        // positional convention, the flag predates it and stays supported.
        const conversationId = args.conversationId ?? flags.conversation
        if (!conversationId) {
            throw new UsageError(
                'Missing conversation ID. Pass it positionally (`conversations get <id>`) or via --conversation.'
            )
        }
        if (args.conversationId && flags.conversation) {
            throw new UsageError(
                'Pass the conversation ID either positionally or via --conversation, not both.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/conversations/{conversationId}',
            {
                params: {
                    path: { agentId, conversationId }
                }
            }
        )
        throwIfError(response, error)
        // GetConversationResponse wraps the conversation (with nested
        // messages) in { data, pagination }; --json prints that whole
        // envelope as-is, but the display row only needs the metadata
        // fields shared with `conversations list`.
        const conversation = (data as { data: Record<string, unknown> }).data
        // Humans read ISO dates; --plain keeps the raw epoch for scripts.
        const formatTimestamp =
            this.mode(flags) === 'pretty'
                ? formatEpochSeconds
                : (v: unknown) => String(v ?? '')
        this.printData(
            flags,
            data,
            [
                {
                    id: String(conversation.id ?? ''),
                    title: String(conversation.title ?? ''),
                    status: String(conversation.status ?? ''),
                    createdAt: formatTimestamp(conversation.createdAt),
                    updatedAt: formatTimestamp(conversation.updatedAt)
                }
            ],
            COLUMNS
        )
    }
}
