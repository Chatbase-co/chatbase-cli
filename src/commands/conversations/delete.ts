import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'

export default class ConversationsDelete extends AgentCommand {
    static override summary =
        'Permanently delete a conversation, or all of a user’s conversations'
    static override description =
        'Deletes from every source (API, widget, WhatsApp, and the like); ' +
        'deleted conversations disappear from chat logs and API responses. ' +
        'This cannot be undone.\n\n' +
        'With --user, deletes every conversation of that user. Deleting a ' +
        'contact does not delete their conversations, so run this as well. ' +
        'Conversations still in HIPAA processing are skipped; rerun later ' +
        'to delete them.'
    static override examples = [
        '<%= config.bin %> conversations delete conv_123 -a agt_123 --confirm conv_123',
        '<%= config.bin %> conversations delete --user jane@example.com -a agt_123 --confirm jane@example.com'
    ]
    static override args = {
        conversationId: Args.string({
            description: 'Conversation ID (omit when using --user)'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        user: Flags.string({
            description:
                'Delete every conversation of this user ID (for identified widget users, the contact’s external ID)'
        }),
        confirm: Flags.string({
            description:
                'Confirm by repeating the conversation or user ID (required in scripts and CI)'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConversationsDelete)
        const target = flags.user ?? args.conversationId
        if (!target || (flags.user && args.conversationId)) {
            throw new UsageError(
                'Pass either a CONVERSATION_ID or --user <userId>, not both.'
            )
        }
        await this.confirmDeletion(flags, target)

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        if (!flags.user) {
            const { error, response } = await client.DELETE(
                '/agents/{agentId}/conversations/{conversationId}',
                { params: { path: { agentId, conversationId: target } } }
            )
            throwIfError(response, error)
            this.success(flags, `Deleted conversation ${target}`)
            return
        }

        const { data, error, response } = await client.DELETE(
            '/agents/{agentId}/users/{userId}/conversations',
            { params: { path: { agentId, userId: target } } }
        )
        throwIfError(response, error)
        const counts = data?.data
        if (this.mode(flags) === 'json') {
            this.printData(flags, data, [], [])
            return
        }
        this.success(
            flags,
            `Deleted ${counts?.deletedCount ?? 0} conversation(s) of user ${target}`
        )
        if (counts?.skippedCount) {
            this.note(
                flags,
                `${counts.skippedCount} skipped: HIPAA processing has not finished. Rerun later to delete them.`
            )
        }
    }

    private async confirmDeletion(
        flags: { confirm?: string; 'no-input'?: boolean },
        target: string
    ): Promise<void> {
        if (flags.confirm === target) return
        if (flags.confirm)
            throw new UsageError(`--confirm value does not match ${target}.`)
        if (!process.stdin.isTTY || flags['no-input']) {
            throw new UsageError(
                `Deleting conversations is permanent. Re-run with --confirm ${target}`
            )
        }
        const { input } = await import('@inquirer/prompts')
        const typed = await input({
            message: `Type ${target} to confirm deletion:`
        })
        if (typed.trim() !== target)
            throw new UsageError('Confirmation did not match; aborted.')
    }
}
