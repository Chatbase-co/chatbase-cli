import { Args, Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
import { UsageError } from '../../errors/errors.js'
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
        '<%= config.bin %> tickets messages 42 -a agt_123',
        '<%= config.bin %> tickets messages 42 -a agt_123 --all --json'
    ]
    static override args = {
        ticketNumber: Args.integer({
            required: false,
            description: 'Ticket number (alternative to --ticket)'
        })
    }
    static override flags = {
        ...ListCommand.baseFlags,
        ticket: Flags.integer({
            description: 'Ticket number'
        }),
        types: Flags.string({
            description:
                'Message types to include (comma-separated): reply, note, event (default: reply,note)'
        }),
        order: Flags.string({
            description: 'Sort direction',
            options: ['asc', 'desc']
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TicketsMessages)
        // Positional and flag are alternatives — `tickets get <n>` and
        // `tickets update <n>` set the positional convention, the flag
        // predates it and stays supported.
        const ticketNumber = args.ticketNumber ?? flags.ticket
        if (ticketNumber === undefined) {
            throw new UsageError(
                'Missing ticket number. Pass it positionally (`tickets messages <number>`) or via --ticket.'
            )
        }
        if (args.ticketNumber !== undefined && flags.ticket !== undefined) {
            throw new UsageError(
                'Pass the ticket number either positionally or via --ticket, not both.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const extraQuery: Record<string, unknown> = {}
        if (flags.types) extraQuery.types = flags.types
        if (flags.order) extraQuery.order = flags.order

        const { pages, items } = await fetchPages<Record<string, unknown>>(
            (query) =>
                client.GET(
                    '/agents/{agentId}/helpdesk/tickets/{ticketNumber}/messages',
                    {
                        params: {
                            path: {
                                agentId,
                                ticketNumber
                            },
                            query: { ...query, ...extraQuery }
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
