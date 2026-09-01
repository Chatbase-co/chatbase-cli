import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'ticketNumber', header: 'TICKET' },
    { key: 'subject', header: 'SUBJECT' },
    { key: 'statusCategory', header: 'STATUS' },
    { key: 'channel', header: 'CHANNEL' },
    { key: 'createdAt', header: 'CREATED' }
]

export default class TicketsSearch extends AgentCommand {
    static override description = 'Search tickets by message content'
    static override examples = [
        '<%= config.bin %> tickets search "refund not received" -a agt_123',
        '<%= config.bin %> tickets search "refund" -a agt_123 --limit 10 --json'
    ]
    static override args = {
        query: Args.string({
            required: true,
            description:
                'Free-text search terms (matched against ticket messages)'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        limit: Flags.integer({
            description: 'Number of results (1–50, default 20)',
            min: 1,
            max: 50
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TicketsSearch)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { data, error, response } = await client.POST(
            '/agents/{agentId}/helpdesk/tickets/search',
            {
                params: { path: { agentId } },
                body: {
                    query: args.query,
                    limit: flags.limit ?? 20
                }
            }
        )
        throwIfError(response, error)
        const result = data as {
            data: Record<string, unknown>[]
            pagination: unknown
        }
        const rows = result.data.map((t) => ({
            ticketNumber: String(t.ticketNumber ?? ''),
            subject: String(t.subject ?? ''),
            statusCategory: String(t.statusCategory ?? ''),
            channel: String(t.channel ?? ''),
            createdAt: String(t.createdAt ?? '')
        }))
        this.printData(flags, data, rows, COLUMNS)
    }
}
