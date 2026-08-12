import { ListCommand } from '../../base/list-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'ticketNumber', header: 'TICKET' },
    { key: 'subject', header: 'SUBJECT' },
    { key: 'statusCategory', header: 'STATUS' },
    { key: 'channel', header: 'CHANNEL' },
    { key: 'createdAt', header: 'CREATED' }
]

export default class TicketsList extends ListCommand {
    static override description = 'List helpdesk tickets for an agent'
    static override examples = [
        '<%= config.bin %> tickets list -a agt_123',
        '<%= config.bin %> tickets list -a agt_123 --all --json'
    ]
    static override flags = { ...ListCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(TicketsList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        type Page = {
            data: Array<Record<string, unknown>>
            pagination: {
                cursor?: string | null
                hasMore: boolean
                total?: number
            }
        }

        const pages: Page[] = []
        let cursor = flags.cursor
        for (;;) {
            const { data, error, response } = await client.GET(
                '/agents/{agentId}/helpdesk/tickets',
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
            p.data.map((t) => ({
                ticketNumber: String(t.ticketNumber ?? ''),
                subject: String(t.subject ?? ''),
                statusCategory: String(t.statusCategory ?? ''),
                channel: String(t.channel ?? ''),
                createdAt: String(t.createdAt ?? '')
            }))
        )
        const last = pages.at(-1)
        // --json must stay the raw API shape even when --all merges pages
        const raw =
            pages.length === 1
                ? pages[0]
                : {
                      data: pages.flatMap((p) => p.data),
                      pagination: last?.pagination
                  }

        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
