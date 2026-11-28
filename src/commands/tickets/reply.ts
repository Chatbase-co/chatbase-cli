import fs from 'node:fs'
import path from 'node:path'
import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { assertFileReadable } from '../../base/assert-file.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type CreateTicketMessageBody = components['schemas']['CreateTicketMessageBody']

const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024
// The spec caps the whole request body at "about 4 MB"; base64 of 3 MB is 4 MiB.
const MAX_TOTAL_BASE64_CHARS = 4 * 1024 * 1024
const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.log': 'text/plain',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.zip': 'application/zip',
    '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx':
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

function readAttachment(
    file: string
): NonNullable<CreateTicketMessageBody['attachments']>[number] {
    assertFileReadable(file)
    // Size check first, so a huge file is never loaded into memory.
    if (fs.statSync(file).size > MAX_ATTACHMENT_BYTES) {
        throw new UsageError(`Attachment "${file}" is over the 3 MB limit.`)
    }
    return {
        name: path.basename(file),
        type:
            MIME_TYPES[path.extname(file).toLowerCase()] ??
            'application/octet-stream',
        data: fs.readFileSync(file).toString('base64')
    }
}

export default class TicketsReply extends AgentCommand {
    static override description =
        "Post an agent reply to a ticket's message thread"
    static override examples = [
        '<%= config.bin %> tickets reply 42 -m "On it" --author-email sam@example.com -a agt_123',
        '<%= config.bin %> tickets reply 42 -m "See screenshots" --attach before.png --attach after.png --author-email sam@example.com -a agt_123',
        '<%= config.bin %> tickets reply 42 -m "Called customer" --type note --author-email sam@example.com -a agt_123'
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
        type: Flags.string({
            description:
                'reply (default) is delivered to the customer; note is internal, never delivered, and also works on closed or merged tickets',
            options: ['reply', 'note'],
            default: 'reply'
        }),
        message: Flags.string({
            char: 'm',
            description:
                'Message body as GitHub-flavored Markdown (may be omitted when --attach is given)'
        }),
        attach: Flags.string({
            description:
                'File to attach; repeat for more (max 5 files, about 3 MB in total). Executables and files whose content does not match their extension are rejected',
            multiple: true,
            // Without this, `--attach a.png 42` reads 42 as a second file.
            multipleNonGreedy: true
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
        const files = flags.attach ?? []
        if (!flags.message?.trim() && files.length === 0) {
            throw new UsageError(
                'Pass a message (-m) or at least one --attach.'
            )
        }
        if (files.length > MAX_ATTACHMENTS) {
            throw new UsageError(
                `At most ${MAX_ATTACHMENTS} attachments per message.`
            )
        }
        const attachments = files.map(readAttachment)
        if (
            attachments.reduce((n, a) => n + a.data.length, 0) >
            MAX_TOTAL_BASE64_CHARS
        ) {
            throw new UsageError(
                'Attachments are too large together. The request is limited to about 4 MB, which is about 3 MB of files in total.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const body: CreateTicketMessageBody = {
            type: flags.type as CreateTicketMessageBody['type'],
            content: flags.message ?? '',
            ...(attachments.length ? { attachments } : {}),
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
        this.success(
            flags,
            `${flags.type === 'note' ? 'Note' : 'Reply'} posted to ticket ${ticketNumber}`
        )
    }
}
