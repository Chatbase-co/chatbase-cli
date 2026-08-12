import { Args } from '@oclif/core'
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

export default class TicketsGet extends AgentCommand {
    static override description = 'Show one helpdesk ticket'
    static override examples = ['<%= config.bin %> tickets get 42 -a agt_123']
    static override args = {
        ticketNumber: Args.integer({
            required: true,
            description: 'Ticket number'
        })
    }
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TicketsGet)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/helpdesk/tickets/{ticketNumber}',
            {
                params: {
                    path: { agentId, ticketNumber: args.ticketNumber }
                }
            }
        )
        throwIfError(response, error)
        // GET .../tickets/{ticketNumber} returns the Ticket directly (no
        // {data, pagination} envelope) — --json prints it as-is.
        const ticket = data as unknown as Record<string, unknown>
        this.printData(
            flags,
            data,
            [
                {
                    ticketNumber: String(ticket.ticketNumber ?? ''),
                    subject: String(ticket.subject ?? ''),
                    statusCategory: String(ticket.statusCategory ?? ''),
                    channel: String(ticket.channel ?? ''),
                    createdAt: String(ticket.createdAt ?? '')
                }
            ],
            COLUMNS
        )
    }
}
