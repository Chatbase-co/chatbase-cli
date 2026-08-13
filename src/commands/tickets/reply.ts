import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { components } from '../../generated/api.js'

type CreateTicketMessageBody = components['schemas']['CreateTicketMessageBody']

export default class TicketsReply extends AgentCommand {
    static override description =
        "Post an agent reply to a ticket's message thread"
    static override examples = [
        '<%= config.bin %> tickets reply --ticket 42 -m "On it" --author-email sam@example.com -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        ticket: Flags.integer({
            required: true,
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
        const { flags } = await this.parse(TicketsReply)
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
                    path: { agentId, ticketNumber: flags.ticket }
                },
                body
            }
        )
        throwIfError(response, error)
        this.success(flags, `Reply posted to ticket ${flags.ticket}`)
    }
}
