import { ListCommand } from '../../base/list-command.js'
import { throwIfError } from '../../client/client.js'
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
        '<%= config.bin %> conversations list -a agt_123 --all --json'
    ]
    static override flags = { ...ListCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsList)
        const agentId = this.agentId(flags)
        const client = this.apiClient(flags)

        type Page = {
            data: Array<Record<string, string>>
            pagination: { cursor?: string; hasMore: boolean; total: number }
        }

        const pages: Page[] = []
        let cursor = flags.cursor
        for (;;) {
            const { data, error, response } = await client.GET(
                '/agents/{agentId}/conversations',
                {
                    params: {
                        path: { agentId },
                        query: { cursor, limit: flags.limit }
                    }
                }
            )
            throwIfError(response, error)
            const page = data as unknown as Page
            pages.push(page)
            if (
                !flags.all ||
                !page.pagination.hasMore ||
                !page.pagination.cursor
            )
                break
            cursor = page.pagination.cursor
        }

        const rows = pages.flatMap((p) =>
            p.data.map((c) => ({
                id: c.id ?? '',
                title: c.title ?? '',
                status: c.status ?? '',
                createdAt: c.createdAt ?? '',
                updatedAt: c.updatedAt ?? ''
            }))
        )
        const last = pages.at(-1)
        const raw =
            pages.length === 1
                ? pages[0]
                : { data: rows, pagination: last?.pagination }

        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
