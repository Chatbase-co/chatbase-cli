import { Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { fetchAllPages } from '../../client/paginate.js'
import { type Column, formatEpochSeconds } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'role', header: 'ROLE' },
    { key: 'createdAt', header: 'CREATED' }
]

export default class MessagesList extends ListCommand {
    static override description = 'List messages in a conversation'
    static override examples = [
        '<%= config.bin %> messages list --conversation conv_123 -a agt_123',
        '<%= config.bin %> messages list --conversation conv_123 -a agt_123 --all --json'
    ]
    static override flags = {
        ...ListCommand.baseFlags,
        conversation: Flags.string({
            required: true,
            description: 'Conversation ID'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(MessagesList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { pages, items } = await fetchAllPages<Record<string, unknown>>(
            (query) =>
                client.GET(
                    '/agents/{agentId}/conversations/{conversationId}/messages',
                    {
                        params: {
                            path: {
                                agentId,
                                conversationId: flags.conversation
                            },
                            query
                        }
                    }
                ),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        // Humans read ISO dates; --plain keeps the raw epoch for scripts.
        const ts =
            this.mode(flags) === 'pretty'
                ? formatEpochSeconds
                : (v: unknown) => String(v ?? '')
        const rows = items.map((m) => ({
            id: String(m.id ?? ''),
            role: String(m.role ?? ''),
            createdAt: ts(m.createdAt)
        }))
        const last = pages.at(-1)
        // --json must stay the raw API shape even when --all merges pages
        const raw =
            pages.length === 1
                ? pages[0]
                : { data: items, pagination: last?.pagination }

        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
