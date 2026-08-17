import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { bodyFieldFlags } from '../../base/base-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import type { components } from '../../generated/api.js'

type CreateTicketBody = components['schemas']['CreateTicketBody']

export default class TicketsCreate extends AgentCommand {
    static override description = 'Create a helpdesk ticket'
    static override examples = [
        '<%= config.bin %> tickets create --subject "Export failing" -f description="Customer cannot export." --customer-email jane@example.com -a agt_123',
        '<%= config.bin %> tickets create --subject "Export failing" --data \'{"description":"Customer cannot export.","customer":{"email":"jane@example.com"}}\' -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        ...bodyFieldFlags,
        subject: Flags.string({ description: 'Ticket subject' }),
        'customer-email': Flags.string({
            description:
                'Customer email — builds the required customer object (alternative to customer in --data)'
        }),
        'customer-name': Flags.string({
            description:
                'Customer display name, used only when the email creates a new customer record',
            dependsOn: ['customer-email']
        }),
        data: Flags.string({
            description:
                'JSON body (@file, @-, or inline). Fields: subject, description, customer, statusId, statusCategory, assigneeId, assigneeEmail, teamId'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(TicketsCreate)
        const customerEmail = flags['customer-email']
        const body = {
            ...(await readBodyData(flags.data, flags.field)),
            ...(flags.subject ? { subject: flags.subject } : {}),
            ...(customerEmail
                ? {
                      customer: {
                          email: customerEmail,
                          ...(flags['customer-name']
                              ? { name: flags['customer-name'] }
                              : {})
                      }
                  }
                : {})
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.POST(
            '/agents/{agentId}/helpdesk/tickets',
            {
                params: { path: { agentId } },
                body: body as CreateTicketBody
            }
        )
        throwIfError(response, error)
        const ticketNumber = (data as { ticketNumber: number }).ticketNumber
        this.success(flags, `Created ticket ${ticketNumber}`)
        process.stdout.write(`${ticketNumber}\n`)
    }
}
