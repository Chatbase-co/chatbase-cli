import { Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { fetchAllPages } from '../../client/paginate.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'type', header: 'TYPE' },
    { key: 'sender', header: 'SENDER' },
    { key: 'content', header: 'CONTENT' },
    { key: 'createdAt', header: 'CREATED' }
]

type Sender = {
    type?: string | null
    id?: string | null
    name?: string | null
    email?: string | null
} | null

function senderLabel(sender: Sender): string {
    if (!sender) return ''
    return sender.name ?? sender.email ?? sender.type ?? ''
}

export default class TicketsMessages extends ListCommand {
    static override description = "List a ticket's message thread"
    static override examples = [
        '<%= config.bin %> tickets messages --ticket 42 -a agt_123',
        '<%= config.bin %> tickets messages --ticket 42 -a agt_123 --all --json'
    ]
    static override flags = {
        ...ListCommand.baseFlags,
        ticket: Flags.integer({
            required: true,
            description: 'Ticket number'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(TicketsMessages)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { pages, items } = await fetchAllPages<Record<string, unknown>>(
            (query) =>
                client.GET(
                    '/agents/{agentId}/helpdesk/tickets/{ticketNumber}/messages',
                    {
                        params: {
                            path: {
                                agentId,
                                ticketNumber: flags.ticket
                            },
                            query
                        }
                    }
                ),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const rows = items.map((m) => ({
            id: String(m.id ?? ''),
            type: String(m.type ?? ''),
            sender: senderLabel(m.sender as Sender),
            content: String(m.contentText ?? m.content ?? ''),
            createdAt: String(m.createdAt ?? '')
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
