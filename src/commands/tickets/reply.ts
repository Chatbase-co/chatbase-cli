import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type CreateTicketMessageBody = components['schemas']['CreateTicketMessageBody']

export default class TicketsReply extends AgentCommand {
    static override description =
        "Post an agent reply to a ticket's message thread"
    static override examples = [
        '<%= config.bin %> tickets reply 42 -m "On it" --author-email sam@example.com -a agt_123'
    ]
    static override args = {
        ticketNumber: Args.integer({
            required: false,
            description: 'Ticket number (alternative to --ticket)'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        ticket: Flags.integer({
            description: 'Ticket number'
        }),
        message: Flags.string({
            char: 'm',
            required: true,
            description: 'Reply body as GitHub-flavored Markdown'
        }),
        'author-id': Flags.string({
            description:
                'Platform user id of the team member the reply is attributed to (exactly one of --author-id/--author-email)',
            exactlyOne: ['author-id', 'author-email']
        }),
        'author-email': Flags.string({
            description:
                'Email of the team member the reply is attributed to (exactly one of --author-id/--author-email)',
            exactlyOne: ['author-id', 'author-email']
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(TicketsReply)
        // Positional and flag are alternatives — `tickets get <n>` and
        // `tickets update <n>` set the positional convention, the flag
        // predates it and stays supported.
        const ticketNumber = args.ticketNumber ?? flags.ticket
        if (ticketNumber === undefined) {
            throw new UsageError(
                'Missing ticket number. Pass it positionally (`tickets reply <number>`) or via --ticket.'
            )
        }
        if (args.ticketNumber !== undefined && flags.ticket !== undefined) {
            throw new UsageError(
                'Pass the ticket number either positionally or via --ticket, not both.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const body: CreateTicketMessageBody = {
            type: 'reply',
            content: flags.message,
            ...(flags['author-id'] ? { authorId: flags['author-id'] } : {}),
            ...(flags['author-email']
                ? { authorEmail: flags['author-email'] }
                : {})
        }
        const { error, response } = await client.POST(
            '/agents/{agentId}/helpdesk/tickets/{ticketNumber}/messages',
            {
                params: {
                    path: { agentId, ticketNumber }
                },
                body
            }
        )
        throwIfError(response, error)
        this.success(flags, `Reply posted to ticket ${ticketNumber}`)
    }
}
