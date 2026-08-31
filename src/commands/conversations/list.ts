import { Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'title', header: 'TITLE' },
    { key: 'status', header: 'STATUS' },
    { key: 'createdAt', header: 'CREATED' },
    { key: 'updatedAt', header: 'UPDATED' }
]

export default class ConversationsList extends ListCommand {
    static override description = 'List conversations for an agent'
    static override examples = [
        '<%= config.bin %> conversations list -a agt_123',
        '<%= config.bin %> conversations list -a agt_123 --user usr_456',
        '<%= config.bin %> conversations list -a agt_123 --all --json'
    ]
    static override flags = {
        ...ListCommand.baseFlags,
        user: Flags.string({
            description:
                'List conversations for a specific user (uses GET /users/{userId}/conversations)'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const fetcherPath = flags.user
            ? '/agents/{agentId}/users/{userId}/conversations'
            : '/agents/{agentId}/conversations'

        const { pages, items } = await fetchPages<Record<string, unknown>>(
            (query) =>
                client.GET(fetcherPath as any, {
                    params: {
                        path: {
                            agentId,
                            ...(flags.user ? { userId: flags.user } : {})
                        },
                        query
                    }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const rows = items.map((c) => ({
            id: String(c.id ?? ''),
            title: String(c.title ?? ''),
            status: String(c.status ?? ''),
            createdAt: String(c.createdAt ?? ''),
            updatedAt: String(c.updatedAt ?? '')
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
