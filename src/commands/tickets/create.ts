import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'

export default class TicketsCreate extends AgentCommand {
    static override description = 'Create a helpdesk ticket'
    static override examples = [
        '<%= config.bin %> tickets create --subject "Export failing" --data \'{"description":"Customer cannot export.","customer":{"email":"jane@example.com"}}\' -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        subject: Flags.string({ description: 'Ticket subject' }),
        data: Flags.string({
            description:
                'JSON body (@file, @-, or inline). Fields: subject, description, customer, statusId, teamId'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(TicketsCreate)
        const body = {
            ...(await readBodyData(flags.data, flags.field)),
            ...(flags.subject ? { subject: flags.subject } : {})
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.POST(
            '/agents/{agentId}/helpdesk/tickets',
            {
                params: { path: { agentId } },
                body: body as never
            }
        )
        throwIfError(response, error)
        const ticketNumber = (data as { ticketNumber: number }).ticketNumber
        this.success(flags, `Created ticket ${ticketNumber}`)
        process.stdout.write(`${ticketNumber}\n`)
    }
}
