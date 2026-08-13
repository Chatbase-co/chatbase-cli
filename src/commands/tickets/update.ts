import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'

export default class TicketsUpdate extends AgentCommand {
    static override description =
        "Update a ticket's status, assignee, and/or team"
    static override examples = [
        '<%= config.bin %> tickets update 42 --data \'{"statusCategory":"closed"}\' -a agt_123'
    ]
    static override args = {
        ticketNumber: Args.integer({
            required: true,
            description: 'Ticket number'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        data: Flags.string({
            description:
                'JSON body (@file, @-, or inline). Fields: statusId, statusCategory, assigneeId, teamId'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TicketsUpdate)
        const body = await readBodyData(flags.data, flags.field)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { error, response } = await client.PATCH(
            '/agents/{agentId}/helpdesk/tickets/{ticketNumber}',
            {
                params: {
                    path: { agentId, ticketNumber: args.ticketNumber }
                },
                body: body as never
            }
        )
        throwIfError(response, error)
        this.success(flags, `Updated ticket ${args.ticketNumber}`)
    }
}
