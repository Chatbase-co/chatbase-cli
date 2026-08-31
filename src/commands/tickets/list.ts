import { Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
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
        '<%= config.bin %> tickets list -a agt_123 --status new,on_you',
        '<%= config.bin %> tickets list -a agt_123 --all --json'
    ]
    static override flags = {
        ...ListCommand.baseFlags,
        status: Flags.string({
            description:
                'Filter by status (comma-separated): new, on_you, on_customer, on_hold, closed, cancelled'
        }),
        channel: Flags.string({
            description: 'Filter by channel (comma-separated, e.g. email,api)'
        }),
        'assignee-id': Flags.string({
            description: 'Filter by assignee UUID, or "none" for unassigned'
        }),
        'team-id': Flags.string({
            description: 'Filter by team UUID, or "none" for no team'
        }),
        'created-after': Flags.string({
            description: 'Only tickets created after this ISO 8601 date'
        }),
        'created-before': Flags.string({
            description: 'Only tickets created before this ISO 8601 date'
        }),
        'sort-by': Flags.string({
            description: 'Sort field',
            options: ['createdAt', 'updatedAt', 'lastMessageAt']
        }),
        order: Flags.string({
            description: 'Sort direction',
            options: ['asc', 'desc']
        }),
        'include-total': Flags.boolean({
            description: 'Include pagination.total in the response'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(TicketsList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const extraQuery: Record<string, unknown> = {}
        if (flags.status) extraQuery.status = flags.status
        if (flags.channel) extraQuery.channel = flags.channel
        if (flags['assignee-id']) extraQuery.assigneeId = flags['assignee-id']
        if (flags['team-id']) extraQuery.teamId = flags['team-id']
        if (flags['created-after'])
            extraQuery.createdAfter = flags['created-after']
        if (flags['created-before'])
            extraQuery.createdBefore = flags['created-before']
        if (flags['sort-by']) extraQuery.sortBy = flags['sort-by']
        if (flags.order) extraQuery.order = flags.order
        if (flags['include-total']) extraQuery.includeTotal = true

        const { pages, items } = await fetchPages<Record<string, unknown>>(
            (query) =>
                client.GET('/agents/{agentId}/helpdesk/tickets', {
                    params: {
                        path: { agentId },
                        query: { ...query, ...extraQuery }
                    }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const rows = items.map((t) => ({
            ticketNumber: String(t.ticketNumber ?? ''),
            subject: String(t.subject ?? ''),
            statusCategory: String(t.statusCategory ?? ''),
            channel: String(t.channel ?? ''),
            createdAt: String(t.createdAt ?? '')
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
