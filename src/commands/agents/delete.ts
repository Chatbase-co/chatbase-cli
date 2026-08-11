import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'

export default class AgentsDelete extends BaseCommand {
    static override description =
        'Permanently delete an agent (cannot be undone)'
    static override examples = [
        '<%= config.bin %> agents delete agt_123 --confirm agt_123'
    ]
    static override args = {
        agentId: Args.string({ required: true, description: 'Agent ID' })
    }
    static override flags = {
        ...BaseCommand.baseFlags,
        confirm: Flags.string({
            description:
                'Confirm by repeating the agent ID (required when not interactive)'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsDelete)
        if (flags.confirm !== args.agentId) {
            if (flags.confirm)
                throw new UsageError(
                    `--confirm value does not match ${args.agentId}.`
                )
            if (!process.stdin.isTTY || flags['no-input']) {
                throw new UsageError(
                    `Deleting an agent is permanent. Re-run with --confirm ${args.agentId}`
                )
            }
            const { input } = await import('@inquirer/prompts')
            const typed = await input({
                message: `Type the agent ID (${args.agentId}) to confirm deletion:`
            })
            if (typed.trim() !== args.agentId)
                throw new UsageError('Confirmation did not match; aborted.')
        }
        const client = this.apiClient(flags)
        const { error, response } = await client.DELETE('/agents/{agentId}', {
            params: { path: { agentId: args.agentId } }
        })
        throwIfError(response, error)
        this.success(flags, `Deleted agent ${args.agentId}`)
    }
}
